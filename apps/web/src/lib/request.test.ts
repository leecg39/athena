import { describe, expect, it } from "vitest";
import { assertSameOrigin, readJsonBody, RequestError } from "./request";

const req = (headers: Record<string, string>, body = "{}") => new Request("http://localhost:3000/api/athena/chat", { method: "POST", headers, body });

describe("assertSameOrigin", () => {
  it("accepts same-origin browser requests", () => {
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin", origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
  });
  it("blocks cross-site and header-less requests", () => {
    const status = (h: Record<string, string>) => {
      try {
        assertSameOrigin(req(h));
        return 200;
      } catch (e) {
        return (e as RequestError).status;
      }
    };
    expect(status({ "sec-fetch-site": "cross-site", host: "localhost:3000" })).toBe(403);
    expect(status({ origin: "https://evil.example", host: "localhost:3000" })).toBe(403);
    expect(status({ "sec-fetch-site": "same-origin", origin: "https://evil.example", host: "localhost:3000" })).toBe(403);
    expect(status({ host: "localhost:3000" })).toBe(403);
  });
});

describe("readJsonBody", () => {
  it("parses JSON within the size limit", async () => {
    await expect(readJsonBody(req({ "content-type": "application/json" }, '{"a":1}'), 100)).resolves.toEqual({ a: 1 });
  });
  it("rejects other content types, oversized and malformed bodies", async () => {
    const code = (p: Promise<unknown>) => p.then(() => 200, (e: RequestError) => e.status);
    expect(await code(readJsonBody(req({ "content-type": "text/plain" }, "{}"), 100))).toBe(415);
    expect(await code(readJsonBody(req({ "content-type": "application/json" }, JSON.stringify({ a: "x".repeat(200) })), 100))).toBe(413);
    expect(await code(readJsonBody(req({ "content-type": "application/json" }, "{nope"), 100))).toBe(400);
  });
});
