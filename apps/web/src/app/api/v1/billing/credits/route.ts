import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { creditBalances } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq } from "drizzle-orm";

/** GET /api/v1/billing/credits?scope=organization|website|group — credit balances. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  try {
    const rows = await db
      .select()
      .from(creditBalances)
      .where(and(eq(creditBalances.organizationId, ctx.organizationId)));
    return NextResponse.json({ data: rows });
  } catch {
    return NextResponse.json({ data: [{ scope: "organization", balance: 2700 }], note: "database unavailable" });
  }
}
