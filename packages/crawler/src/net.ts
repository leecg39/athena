/**
 * SSRF-safe HTTP(S) GET for crawling user-supplied sites.
 *
 * - only http/https, no URL credentials, standard ports
 * - every resolved address must be public; the check runs inside the socket's
 *   DNS lookup so the validated address is the one connected to (no rebinding)
 * - redirects are followed manually and each hop is re-validated
 * - total deadline and a byte cap applied after decompression (zip bombs)
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import zlib from "node:zlib";
import { isIP, type LookupFunction } from "node:net";
import type { Readable, Transform } from "node:stream";

export const CRAWLER_UA = "AthenumBot/1.0 (+https://athenum.example/bot)";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/* ------------------------------------------------------------------ */
/* Address classification                                              */
/* ------------------------------------------------------------------ */

const V4_BLOCKED: [number, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, bits]) => [v4ToInt(base as string), bits as number]);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/** Expand an IPv6 address into 8 16-bit groups (handles "::" and a dotted IPv4 tail). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (isIP(maybeV4) !== 4) return null;
    const n = v4ToInt(maybeV4);
    tail.push(n >>> 16, n & 0xffff);
    s = `${s.slice(0, lastColon)}:`;
    if (s.endsWith("::")) s = `${s}`;
    else s = s.slice(0, -1);
  }
  const [head, rest] = s.includes("::") ? s.split("::") : [s, null];
  const parse = (part: string) => (part ? part.split(":").filter((x) => x !== "").map((h) => parseInt(h, 16)) : []);
  const h = parse(head);
  const r = rest === null ? [] : parse(rest);
  const fill = 8 - tail.length - h.length - r.length;
  if (rest === null && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...h, ...new Array(rest === null ? 0 : fill).fill(0), ...r, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const embeddedV4 = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::, ::1, IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return false; // NAT64
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return false; // Teredo
  if (g[0] === 0x2002) return isPublicV4(embeddedV4(g[1], g[2])); // 6to4
  return (g[0] & 0xe000) === 0x2000; // global unicast 2000::/3 only
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

/* ------------------------------------------------------------------ */
/* Fetcher                                                             */
/* ------------------------------------------------------------------ */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** write requests are sent once and never follow redirects */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

/** Caller headers: no Host override, no CR/LF (header injection). */
function checkHeaders(headers: Record<string, string>): Record<string, string> {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "host") throw new BlockedUrlError("The host header cannot be set");
    if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) throw new BlockedUrlError(`Invalid header: ${k}`);
  }
  return headers;
}

export interface SafeResponse {
  status: number;
  /** final URL after redirects */
  url: string;
  contentType: string;
  body: string;
}

export interface FetcherConfig {
  /** address policy (tests may widen it to reach a loopback server) */
  allowAddress?: (ip: string) => boolean;
  /** permit non-standard ports (tests only) */
  allowAnyPort?: boolean;
}

const STANDARD_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function guardedLookup(allow: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      if (!list.length) return callback(new Error(`No address for ${hostname}`), "", 0);
      // reject if ANY record is private (prevents mixed public/private answers)
      if (list.some((a) => !allow(a.address))) {
        return callback(new BlockedUrlError(`Host resolves to a non-public address: ${hostname}`), "", 0);
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

function validateUrl(raw: string, cfg: Required<FetcherConfig>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`Unsupported scheme: ${url.protocol}`);
  if (url.username || url.password) throw new BlockedUrlError("Credentials in URLs are not allowed");
  if (!cfg.allowAnyPort && !STANDARD_PORTS.has(url.port)) throw new BlockedUrlError(`Port ${url.port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("Missing host");
  if (isIP(host) && !cfg.allowAddress(host)) throw new BlockedUrlError(`Address is not public: ${host}`);
  return url;
}

function decoderFor(encoding: string | undefined): Transform | null {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function charsetOf(contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType);
  const label = m?.[1]?.toLowerCase() ?? "utf-8";
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return "utf-8";
  }
}

function getOnce(url: URL, cfg: Required<FetcherConfig>, opts: Required<SafeFetchOptions>, deadline: number) {
  return new Promise<{ status: number; location?: string; contentType: string; body: string }>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error("Request timed out"));
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: opts.method,
        lookup: guardedLookup(cfg.allowAddress),
        agent: false,
        headers: {
          "user-agent": CRAWLER_UA,
          accept: opts.accept,
          "accept-encoding": "gzip, deflate, br",
          ...opts.headers,
          ...(opts.body ? { "content-length": String(Buffer.byteLength(opts.body)) } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return done(() => resolve({ status, location: res.headers.location, contentType, body: "" }));
        }
        const decoder = decoderFor(res.headers["content-encoding"] as string | undefined);
        const stream: Readable = decoder ? res.pipe(decoder) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        const fail = (e: Error) =>
          done(() => {
            stream.destroy();
            req.destroy();
            reject(e);
          });
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) return fail(new Error("Response too large"));
          chunks.push(chunk);
        });
        stream.on("error", (e) => fail(e));
        res.on("aborted", () => fail(new Error("Connection aborted")));
        stream.on("end", () =>
          done(() => resolve({ status, contentType, body: new TextDecoder(charsetOf(contentType)).decode(Buffer.concat(chunks)) })),
        );
      },
    );
    const timer = setTimeout(() => {
      done(() => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
    }, remaining);
    req.on("error", (e) => done(() => reject(e)));
    req.end(opts.body || undefined);
  });
}

export function createSafeFetcher(config: FetcherConfig = {}) {
  const cfg: Required<FetcherConfig> = {
    allowAddress: config.allowAddress ?? isPublicAddress,
    allowAnyPort: config.allowAnyPort ?? false,
  };
  return async function fetchSafe(raw: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
    const opts: Required<SafeFetchOptions> = {
      timeoutMs: options.timeoutMs ?? 10_000,
      maxBytes: options.maxBytes ?? 2_000_000,
      maxRedirects: options.maxRedirects ?? 5,
      accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      method: options.method ?? "GET",
      headers: checkHeaders(options.headers ?? {}),
      body: options.body ?? "",
    };
    const deadline = Date.now() + opts.timeoutMs;
    let url = validateUrl(raw, cfg);
    if (opts.method !== "GET") {
      // a write is sent exactly once: redirects are returned, never re-sent
      const r = await getOnce(url, cfg, opts, deadline);
      return { status: r.status, url: url.toString(), contentType: r.contentType, body: r.body };
    }
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      const r = await getOnce(url, cfg, opts, deadline);
      if (r.location === undefined) return { status: r.status, url: url.toString(), contentType: r.contentType, body: r.body };
      url = validateUrl(new URL(r.location, url).toString(), cfg);
    }
    throw new Error(`Too many redirects (>${opts.maxRedirects})`);
  };
}

/** Default production fetcher: public addresses and standard ports only. */
export const safeFetch = createSafeFetcher();
