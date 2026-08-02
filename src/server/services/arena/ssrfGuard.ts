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

export type SsrfPolicy = {
  /** Allow http:// loopback only when OLIVE_ALLOW_LOOPBACK_HTTP=true. */
  allowLoopbackHttp: boolean;
};

export function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** IPv4 dotted-quad private / reserved / link-local / CGNAT / metadata. */
export function isBlockedIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ([a, b, c, Number(m[4])].some((n) => n > 255)) return true;
  if (a === 0) return true; // "this" network
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Extract IPv4 from IPv4-mapped IPv6.
 * Accepts both dotted (`::ffff:127.0.0.1`) and hex-compressed (`::ffff:7f00:1`)
 * forms. Node's URL parser rewrites bracketed dotted-mapped literals to hex.
 */
export function ipv4FromMappedIpv6(ip: string): string | null {
  const addr = stripBrackets(ip);
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
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
    throw new Error("Only http/https endpoints are supported");
  }
  if (url.username || url.password) {
    throw new Error("Credentialed endpoints are not supported");
  }

  const host = stripBrackets(url.hostname);
  if (!host) throw new Error("Invalid endpointUrl");

  // Block obvious metadata hostnames even before DNS
  if (host === "metadata.google.internal" || host.endsWith(".local")) {
    if (!(policy.allowLoopbackHttp && isLoopbackHostname(host))) {
      throw new Error("Private endpoints are not supported");
    }
  }

  const loopbackName = isLoopbackHostname(host);
  const allowLoopbackHttp =
    policy.allowLoopbackHttp && loopbackName && url.protocol === "http:";

  if (url.protocol !== "https:" && !allowLoopbackHttp) {
    throw new Error("HTTPS endpoints are required");
  }

  // Literal IP in the URL — validate immediately
  if (net.isIP(host)) {
    if (isBlockedIpAddress(host) && !(allowLoopbackHttp && isLoopbackIp(host))) {
      throw new Error("Private endpoints are not supported");
    }
  }
}

/**
 * Resolve hostname and return only publicly routable addresses
 * (or loopback when explicitly allowed).
 */
export async function resolvePinnedAddresses(
  hostname: string,
  policy: SsrfPolicy,
): Promise<string[]> {
  const host = stripBrackets(hostname);
  const allowLoopback =
    policy.allowLoopbackHttp && (isLoopbackHostname(host) || isLoopbackIp(host));

  if (net.isIP(host)) {
    if (isBlockedIpAddress(host) && !(allowLoopback && isLoopbackIp(host))) {
      throw new Error("Private endpoints are not supported");
    }
    return [host];
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  if (!records.length) throw new Error(`DNS resolution failed for ${host}`);

  const allowed: string[] = [];
  for (const { address } of records) {
    if (isBlockedIpAddress(address)) {
      if (allowLoopback && isLoopbackIp(address)) {
        allowed.push(address);
        continue;
      }
      throw new Error(`Resolved address ${address} is not allowed (private/reserved)`);
    }
    allowed.push(address);
  }
  if (!allowed.length) throw new Error("No allowed addresses after DNS resolution");
  return allowed;
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
        finish(new Error("Upstream response exceeded maximum allowed size"));
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
  const addresses = await resolvePinnedAddresses(url.hostname, policy);
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
          reject(new Error(`Upstream redirect refused (${res.statusCode})`));
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
