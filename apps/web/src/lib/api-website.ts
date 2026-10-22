import "server-only";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, websites } from "@athena/db";
import type { ApiContext } from "./api-key";

export type ApiWebsite = typeof websites.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The website only if it belongs to the API key's organization; otherwise a 400/404 response. */
export async function resolveApiWebsite(ctx: ApiContext, websiteId: string | null | undefined): Promise<ApiWebsite | NextResponse> {
  if (!websiteId || !UUID.test(websiteId)) return NextResponse.json({ error: "websiteId (uuid) required" }, { status: 400 });
  const [site] = await db
    .select()
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.organizationId, ctx.organizationId), isNull(websites.deletedAt)));
  return site ?? NextResponse.json({ error: "website not found" }, { status: 404 });
}

export function notYetAvailable(what: string): NextResponse {
  return NextResponse.json({ error: `${what} is not available yet in this API version` }, { status: 501 });
}
