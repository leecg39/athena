import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, runs } from "@athena/db";
import { getWebsiteForUser } from "@athena/core/tenancy";
import { getRunProgress } from "@athena/jobs/collection";
import { getUser } from "@/lib/session";

/** GET /api/runs/:id — progress for polling (session auth, website access required). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [run] = await db.select({ websiteId: runs.websiteId }).from(runs).where(eq(runs.id, id));
  if (!run || !(await getWebsiteForUser(db, user.id, run.websiteId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await getRunProgress(db, id), { headers: { "cache-control": "no-store" } });
}
