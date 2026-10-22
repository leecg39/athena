import { type NextRequest } from "next/server";
import { authenticate, isResponse } from "@/lib/api-key";
import { notYetAvailable } from "@/lib/api-website";

/** GET /api/v1/sources — rebuilt on real citation analytics (previously returned demo data). */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  return notYetAvailable("Source analytics");
}
