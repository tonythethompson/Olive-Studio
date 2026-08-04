/**
 * SSRF defenses for the Arena cloud-inference proxy.
 *
 * Strategy:
 *  1. Protocol / credential checks on the URL
 *  2. DNS resolve (or treat literal IPs as already resolved)
 *  3. Reject private / link-local / metadata ranges at the *resolved IP*
 *  4. Connect to the pinned IP with the original Host header + TLS SNI
 *     so a rebinding DNS update after validation cannot retarget the TCP connect
 */
import dns from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import {
  isBlockedIpv4,
  isLoopbackHostname,
  stripBrackets,
} from "../../../lib/arenaEndpointPolicy.ts";

// Re-export shared pure helpers so existing server tests keep importing from here.
export { isBlockedIpv4, isLoopbackHostname, stripBrackets };

/** Typed policy/SSRF rejection so routes can map to 400 without regex on message text. */
export class SsrfPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfPolicyError";
  }
}

export type SsrfPolicy = {
  /** Allow http:// loopback only when OLIVE_ALLOW_LOOPBACK_HTTP=true. */
  allowLoopbackHttp: boolean;
};

/**
 * Extract IPv4 embedded in IPv6:
 * - IPv4-mapped `::ffff:x.x.x.x` / `::ffff:HHHH:HHHH`
 * - IPv4-compatible `::/96` `::x.x.x.x` / `::HHHH:HHHH`
 *
 * Node's URL parser rewrites bracketed dotted forms (e.g. `[::127.0.0.1]`,
 * `[::ffff:127.0.0.1]`) to the hex-compressed hostname forms.
 */
function ipv4FromHexPair(hiHex: string, loHex: string): string {
  const hi = Number.parseInt(hiHex, 16);
  const lo = Number.parseInt(loHex, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function ipv4FromMappedIpv6(ip: string): string | null {
  const addr = stripBrackets(ip);

  // IPv4-mapped ::ffff:x.x.x.x / ::ffff:HHHH:HHHH (and expanded 0:0:0:0:0:ffff:…)
  const mappedDotted =
    /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr) ??
    /^0:0:0:0:0:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  if (mappedDotted) return mappedDotted[1];
  const mappedHex =
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr) ??
    /^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (mappedHex) return ipv4FromHexPair(mappedHex[1]!, mappedHex[2]!);

  // Deprecated IPv4-compatible ::/96 (Node emits [::127.0.0.1] as ::7f00:1)
  const compatDotted =
    /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr) ??
    /^0:0:0:0:0:0:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (compatDotted) return compatDotted[1];
  const compatHex =
    /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr) ??
    /^0:0:0:0:0:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (compatHex) return ipv4FromHexPair(compatHex[1]!, compatHex[2]!);

  return null;
}

export function isLoopbackIp(ip: string): boolean {
  if (ip === "::1") return true;
  if (ip.startsWith("127.")) return true;
  const mapped = ipv4FromMappedIpv6(ip);
  if (mapped) return mapped.startsWith("127.");
  return false;
}

export function isBlockedIpAddress(ip: string): boolean {
  const addr = stripBrackets(ip);
  if (net.isIPv4(addr)) return isBlockedIpv4(addr);
  if (net.isIPv6(addr)) {
    if (addr === "::" || addr === "::1") return true;
    if (addr.toLowerCase().startsWith("fe80:")) return true; // link-local
    if (addr.toLowerCase().startsWith("fc") || addr.toLowerCase().startsWith("fd")) return true; // ULA
    const mapped = ipv4FromMappedIpv6(addr);
    if (mapped) return isBlockedIpv4(mapped);
    return false;
  }
  return true; // unknown form → reject
}

/**
 * Validate URL policy (protocol, credentials, hostname shape) before DNS.
 */
export function assertUrlPolicy(url: URL, policy: SsrfPolicy): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfPolicyError("Only http/https endpoints are supported");
  }
  if (url.username || url.password) {
    throw new SsrfPolicyError("Credentialed endpoints are not supported");
  }

  const host = stripBrackets(url.hostname);
  if (!host) throw new SsrfPolicyError("Invalid endpointUrl");

  // Metadata / mDNS names are never Arena-eligible (no loopback exemption).
  if (host === "metadata.google.internal" || host.endsWith(".local")) {
    throw new SsrfPolicyError("Private endpoints are not supported");
  }

  const loopbackName = isLoopbackHostname(host);
  const allowLoopbackHttp =
    policy.allowLoopbackHttp && loopbackName && url.protocol === "http:";

  if (url.protocol !== "https:" && !allowLoopbackHttp) {
    throw new SsrfPolicyError("HTTPS endpoints are required");
  }

  // Literal IP in the URL — validate immediately
  if (net.isIP(host)) {
    if (isBlockedIpAddress(host) && !(allowLoopbackHttp && isLoopbackIp(host))) {
      throw new SsrfPolicyError("Private endpoints are not supported");
    }
  }
}

function abortError(): Error {
  return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/**
 * DNS lookup that honors AbortSignal via Promise.race.
 * Node's dns.promises.lookup does not reliably cancel on abort in all versions;
 * the underlying lookup may continue in the background after we reject.
 */
async function lookupAllWithSignal(
  host: string,
  signal?: AbortSignal,
): Promise<Array<{ address: string; family: number }>> {
  if (signal?.aborted) throw abortError();
  const lookup = dns.lookup(host, { all: true, verbatim: true });
  if (!signal) return lookup;

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    lookup.then(
      (records) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(records);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Stable order with IPv4 before IPv6 so broken IPv6 paths do not win when an
 * A record is available. Relative order within each family is preserved.
 */
export function preferIpv4First(addresses: string[]): string[] {
  return [...addresses].sort((a, b) => {
    const aV4 = net.isIPv4(a) ? 0 : 1;
    const bV4 = net.isIPv4(b) ? 0 : 1;
    return aV4 - bV4;
  });
}

/**
 * Resolve hostname and return only publicly routable addresses
 * (or loopback when explicitly allowed).
 * Pass `signal` (typically the Arena route AbortController) so DNS can fail
 * with AbortError and the route keeps its 504 timeout mapping.
 */
export async function resolvePinnedAddresses(
  hostname: string,
  policy: SsrfPolicy,
  signal?: AbortSignal,
): Promise<string[]> {
  const host = stripBrackets(hostname);
  const allowLoopback =
    policy.allowLoopbackHttp && (isLoopbackHostname(host) || isLoopbackIp(host));

  if (net.isIP(host)) {
    if (isBlockedIpAddress(host) && !(allowLoopback && isLoopbackIp(host))) {
      throw new SsrfPolicyError("Private endpoints are not supported");
    }
    return [host];
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookupAllWithSignal(host, signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new SsrfPolicyError(`DNS resolution failed for ${host}`);
  }
  if (!records.length) throw new SsrfPolicyError(`DNS resolution failed for ${host}`);

  const allowed: string[] = [];
  for (const { address } of records) {
    if (isBlockedIpAddress(address)) {
      if (allowLoopback && isLoopbackIp(address)) {
        allowed.push(address);
        continue;
      }
      throw new SsrfPolicyError(`Resolved address ${address} is not allowed (private/reserved)`);
    }
    allowed.push(address);
  }
  if (!allowed.length) throw new SsrfPolicyError("No allowed addresses after DNS resolution");
  return preferIpv4First(allowed);
}

export type PinnedFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type PinnedFetchResult = {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

/** Max buffered upstream body for Arena proxy responses (untrusted endpoints). */
export const MAX_PINNED_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Thrown when a pinned upstream response exceeds {@link MAX_PINNED_RESPONSE_BYTES}. */
export class UpstreamBodyTooLargeError extends Error {
  constructor(message = "Upstream response exceeded maximum allowed size") {
    super(message);
    this.name = "UpstreamBodyTooLargeError";
  }
}

/**
 * Buffers an upstream response body while enforcing the maximum allowed size.
 *
 * @param res - The upstream response stream to read
 * @param signal - Optional signal that aborts reading
 * @returns The complete response body as a buffer
 */
function readBody(res: IncomingMessage, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (err?: Error, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(buf!);
    };
    const onAbort = () => {
      res.destroy(new Error("Aborted"));
      finish(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    res.on("data", (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > MAX_PINNED_RESPONSE_BYTES) {
        res.destroy(new Error("Response body too large"));
        finish(new UpstreamBodyTooLargeError());
        return;
      }
      chunks.push(buf);
    });
    res.on("end", () => {
      finish(undefined, Buffer.concat(chunks));
    });
    res.on("error", (err) => {
      finish(err);
    });
  });
}

/**
 * Connect to a DNS-validated IP while preserving Host + TLS servername of the original URL.
 * Rejects redirects (caller must not follow Location).
 */
export async function pinnedFetch(url: URL, init: PinnedFetchInit = {}): Promise<PinnedFetchResult> {
  const policy: SsrfPolicy = {
    allowLoopbackHttp: process.env.OLIVE_ALLOW_LOOPBACK_HTTP === "true",
  };
  assertUrlPolicy(url, policy);
  if (init.signal?.aborted) throw abortError();
  const addresses = await resolvePinnedAddresses(url.hostname, policy, init.signal);
  const pinnedIp = addresses[0]!;

  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const path = `${url.pathname || "/"}${url.search || ""}`;
  const headers: Record<string, string> = {
    ...(init.headers ?? {}),
    Host: url.host,
  };
  if (init.body && !headers["Content-Length"] && !headers["content-length"]) {
    headers["Content-Length"] = String(Buffer.byteLength(init.body));
  }

  const transport = isHttps ? https : http;
  const bodyBuf = init.body ? Buffer.from(init.body) : undefined;

  return new Promise<PinnedFetchResult>((resolve, reject) => {
    const onAbort = () => {
      req.destroy();
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: pinnedIp,
        port,
        path,
        method: init.method ?? "GET",
        headers,
        // SNI + cert hostname verification against the original host, not the IP
        servername: net.isIP(stripBrackets(url.hostname)) ? undefined : stripBrackets(url.hostname),
        // Do not follow redirects — any Location would re-open SSRF
        setHost: false,
      },
      (res) => {
        // Explicitly refuse redirects instead of following them
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          reject(new SsrfPolicyError(`Upstream redirect refused (${res.statusCode})`));
          return;
        }

        const status = res.statusCode ?? 0;
        const bufPromise = readBody(res, init.signal);
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => (await bufPromise).toString("utf8"),
          json: async () => JSON.parse((await bufPromise).toString("utf8")),
        });
      },
    );

    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => init.signal?.removeEventListener("abort", onAbort));
    }

    req.on("error", (err) => {
      init.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}
