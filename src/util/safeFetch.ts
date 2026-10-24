import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch, type Response } from 'undici';

/**
 * Fetching URLs that come from outside (sources the editor cites, image
 * download links from third-party APIs or an imported workspace) without
 * letting them reach the server's own network: loopback, private ranges,
 * link-local (cloud metadata at 169.254.169.254), and the IPv6 forms that
 * embed an IPv4 address (::ffff:7f00:1, 64:ff9b::…, 2002:…).
 *
 * The address is checked inside the socket's own DNS lookup, so the IP that
 * was checked is the one connected to (no DNS rebinding between a check and
 * the request). Redirects are followed one by one and re-checked, and
 * credentials are dropped as soon as a redirect leaves the original host.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** The 8 groups of an IPv6 address as numbers (handles "::" and a dotted IPv4 tail). */
function ipv6Groups(ip: string): number[] {
  let v = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    v = v.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = v.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}

const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** true if the address must never be fetched. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blocked.check(ip, 'ipv4');
  if (kind !== 6) return true;
  const g = ipv6Groups(ip);
  if (g.length !== 8 || g.some((x) => !Number.isFinite(x))) return true;
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedAddress(v4(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(v4(g[6]!, g[7]!));
  if (g[0] === 0x2002) return isBlockedAddress(v4(g[1]!, g[2]!));
  return blocked.check(ip, 'ipv6');
}

export class BlockedUrlError extends Error {}

/** DNS lookup that refuses (at connect time) any private or special address. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || !list.length) return callback(new BlockedUrlError(`private network host: ${hostname}`), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: guardedLookup } });

function checkUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('only http(s) URLs are fetched');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new BlockedUrlError('local host');
  // An IP literal never goes through DNS: checked here.
  if (isIP(host) && isBlockedAddress(host)) throw new BlockedUrlError('private network host');
}

const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'x-api-key', 'proxy-authorization'];

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** GET of an untrusted URL. Returns the final response (the caller limits how much it reads). */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response & { finalUrl: string }> {
  let url = new URL(rawUrl);
  const origin = url.host;
  let headers = { ...(opts.headers ?? {}) };
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    checkUrl(url);
    if (url.host !== origin) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase())));
    const res = await fetch(url, { headers, redirect: 'manual', signal, dispatcher: agent });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return Object.assign(res, { finalUrl: url.href });
  }
  throw new BlockedUrlError('too many redirects');
}
