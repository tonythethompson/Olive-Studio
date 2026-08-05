/**
 * Isomorphic Arena outbound endpoint policy (no Node DNS / net).
 *
 * Shared by:
 * - `arenaAssistantSnapshot.ts` (client + server pure helpers)
 * - `ssrfGuard.ts` (server reuses the same IPv4/IPv6 blocked ranges after DNS pin)
 *
 * Loopback HTTP exemption hosts (narrow, by design): only `localhost`,
 * `127.0.0.1`, and `::1`. Broader 127.0.0.0/8 or alternate IPv6 loopback forms
 * are intentionally NOT allowed for Arena loopback-HTTP override.
 */

export type ArenaEndpointPolicyOpts = {
  /** Allow http:// only for the narrow loopback host set above. */
  allowLoopbackHttp?: boolean;
};

export function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Narrow loopback host names for Arena OLIVE_ALLOW_LOOPBACK_HTTP. */
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

function isLoopbackIpv4Literal(ip: string): boolean {
  const host = stripBrackets(ip);
  return host === "127.0.0.1" || host.startsWith("127.");
}

function parseIpv6(host: string): bigint | null {
  if (!host.includes(":")) return null;
  const parts = host.split("::");
  if (parts.length > 2) return null;
  const expand = (value: string): string[] => {
    if (!value) return [];
    const items = value.split(":");
    const last = items[items.length - 1];
    if (last.includes(".")) {
      const octets = last.split(".").map(Number);
      if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n > 255)) return [];
      items.splice(
        items.length - 1,
        1,
        ((octets[0]! << 8) | octets[1]!).toString(16),
        ((octets[2]! << 8) | octets[3]!).toString(16),
      );
    }
    return items;
  };
  const left = expand(parts[0]!);
  const right = expand(parts[1] ?? "");
  const zeros = 8 - left.length - right.length;
  if (
    (parts.length === 1 && zeros !== 0) ||
    zeros < 0 ||
    [...left, ...right].some((p) => !/^[0-9a-f]{1,4}$/i.test(p))
  ) {
    return null;
  }
  // Zero-pad each hextet so the 128-bit value is always 32 hex digits.
  const groups = [...left, ...Array(zeros).fill("0"), ...right].map((g) =>
    g.padStart(4, "0").toLowerCase(),
  );
  return BigInt(`0x${groups.join("")}`);
}

/**
 * Block private / reserved IPv6 for Arena outbound policy.
 * Covers: loopback, link-local fe80::/10, deprecated site-local fec0::/10,
 * ULA fc00::/7, multicast ff00::/8, and IPv4-mapped/compatible forms.
 */
export function isBlockedIpv6(host: string): boolean {
  const value = parseIpv6(host);
  if (value === null) return false;
  const first = Number(value >> 120n);
  const second = Number((value >> 118n) & 0x3n);
  return (
    value === 1n || // loopback ::1
    (first === 0xfe && second === 0x2) || // link-local fe80::/10
    (first === 0xfe && second === 0x3) || // deprecated site-local fec0::/10
    (first >= 0xfc && first <= 0xfd) || // ULA fc00::/7
    first === 0xff || // multicast ff00::/8
    value >> 32n === 0n || // IPv4-compatible ::/96
    value >> 32n === 0xffffn // IPv4-mapped ::ffff:0:0/96
  );
}

function isLoopbackIpv6(host: string): boolean {
  const value = parseIpv6(host);
  if (value === 1n) return true;
  if (value === null || value >> 32n !== 0n) return false;
  const ipv4 = Number(value & 0xffffffffn);
  return isLoopbackIpv4Literal(
    `${ipv4 >>> 24}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`,
  );
}

/**
 * Shape-level outbound policy (no DNS). Throws Error with a short reason string.
 * Server `assertUrlPolicy` maps the same rules and adds DNS pinning afterward.
 */
export function assertArenaEndpointUrlPolicy(
  rawUrl: string,
  opts?: ArenaEndpointPolicyOpts,
): void {
  const allowLoopbackHttp = opts?.allowLoopbackHttp ?? false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid endpointUrl");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https endpoints are supported");
  }
  if (url.username || url.password) {
    throw new Error("Credentialed endpoints are not supported");
  }
  const host = stripBrackets(url.hostname);
  if (!host) throw new Error("Invalid endpointUrl");

  // Metadata / mDNS names are never Arena-eligible (no loopback exemption —
  // they cannot match the narrow isLoopbackHostname set).
  if (host === "metadata.google.internal" || host.endsWith(".local")) {
    throw new Error("Private endpoints are not supported");
  }

  const loopbackName = isLoopbackHostname(host);
  const allowLoopback = allowLoopbackHttp && loopbackName && url.protocol === "http:";

  if (url.protocol !== "https:" && !allowLoopback) {
    throw new Error("HTTPS endpoints are required");
  }

  // Literal IPv4 and IPv6 (including IPv4-mapped/compatible forms).
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIpv4(host) && !(allowLoopback && isLoopbackIpv4Literal(host))) {
      throw new Error("Private endpoints are not supported");
    }
  } else if (host.includes(":") && isBlockedIpv6(host) && !(allowLoopback && isLoopbackIpv6(host))) {
    throw new Error("Private endpoints are not supported");
  }
}
