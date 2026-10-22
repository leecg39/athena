/**
 * Guards for JSON endpoints used only by the app UI (session cookie auth):
 * same-origin requests only, JSON bodies only, bounded size.
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const hostOf = (req: Request) => req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;

/** CSRF defence in depth on top of SameSite=Lax cookies. */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site && site !== "same-origin") throw new RequestError(403, "Cross-site request blocked");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== hostOf(req)) throw new RequestError(403, "Cross-site request blocked");
  }
  if (!site && !origin) throw new RequestError(403, "Missing request origin");
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new RequestError(415, "Expected a JSON body");
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new RequestError(413, "Request too large");
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError(400, "Empty request");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError(413, "Request too large");
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new RequestError(400, "Invalid JSON");
  }
}
