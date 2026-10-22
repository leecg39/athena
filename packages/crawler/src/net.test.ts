import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { isPublicAddress, createSafeFetcher, safeFetch, BlockedUrlError } from "./net";

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:8.8.8.8", true],
    ["2606:4700:4700::1111", true],
    ["2001:db8::1", false],
    ["64:ff9b::a00:1", false],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect-internal") {
        res.writeHead(302, { location: "http://10.0.0.1/secret" });
        return res.end();
      }
      if (req.url === "/redirect-loop") {
        res.writeHead(302, { location: "/redirect-loop" });
        return res.end();
      }
      if (req.url === "/redirect-ok") {
        res.writeHead(301, { location: "/hello" });
        return res.end();
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("x".repeat(300_000));
      }
      if (req.url === "/gzip-bomb") {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(Buffer.alloc(5_000_000, 0x61)));
      }
      if (req.url === "/slow") {
        return setTimeout(() => res.end("late"), 2_000);
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><title>ok</title></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  // test fetcher may reach the loopback test server, but nothing else private
  const testFetch = createSafeFetcher({ allowAddress: (ip) => ip === "127.0.0.1" || isPublicAddress(ip), allowAnyPort: true });

  it("blocks private and loopback targets by default", async () => {
    await expect(safeFetch(`${base}/`)).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("http://localhost/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("http://[::1]/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects non-http schemes and credentials in URLs", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("ftp://example.com/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch("http://user:pass@example.com/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("fetches, follows safe redirects and reports the final URL", async () => {
    const r = await testFetch(`${base}/redirect-ok`);
    expect(r.status).toBe(200);
    expect(r.url).toBe(`${base}/hello`);
    expect(r.body).toContain("<title>ok</title>");
  });

  it("re-validates every redirect hop", async () => {
    await expect(testFetch(`${base}/redirect-internal`)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("stops redirect loops", async () => {
    await expect(testFetch(`${base}/redirect-loop`)).rejects.toThrow(/redirect/i);
  });

  it("enforces size limits, including after decompression", async () => {
    await expect(testFetch(`${base}/big`, { maxBytes: 100_000 })).rejects.toThrow(/too large/i);
    await expect(testFetch(`${base}/gzip-bomb`, { maxBytes: 1_000_000 })).rejects.toThrow(/too large/i);
  });

  it("times out slow servers", async () => {
    await expect(testFetch(`${base}/slow`, { timeoutMs: 300 })).rejects.toThrow(/timed out/i);
  });
});
