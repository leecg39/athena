import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { CMS_PROVIDERS, exportContentPayload, type CmsProvider } from "@athena/core/content";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import { requireWorkspace } from "@/lib/workspace";

/** GET /api/content/{id}/export?provider=… — the latest version as a JSON download (read-only). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  if (!(CMS_PROVIDERS as readonly string[]).includes(provider)) return NextResponse.json({ error: "Unknown CMS" }, { status: 400 });
  try {
    const file = await exportContentPayload(db, { actorId: ws.user.id, websiteId: ws.websiteId, contentId: id, provider: provider as CmsProvider });
    return new NextResponse(file.body, { headers: { "content-type": `${file.contentType}; charset=utf-8`, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
