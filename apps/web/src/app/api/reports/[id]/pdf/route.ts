import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, scheduledReports } from "@athena/db";
import {
  getPublicReportByShareId,
  renderReportPdfBuffer,
} from "@athena/core/reports";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const url = new URL(req.url);
    const shareIdParam = url.searchParams.get("shareId")?.trim();

    let shareId = shareIdParam || "";
    if (!shareId) {
      // Authenticated lookup scoped to current tenant
      const s = await getSettingsContext();
      const [row] = await db
        .select({ shareId: scheduledReports.shareId })
        .from(scheduledReports)
        .where(and(eq(scheduledReports.id, id), eq(scheduledReports.websiteId, s.websiteId)));
      if (!row) {
        return NextResponse.json({ error: "Report not found" }, { status: 404 });
      }
      shareId = row.shareId;
    }

    const reportData = await getPublicReportByShareId(db, shareId);
    const pdfBuffer = renderReportPdfBuffer(reportData);
    const safeFilename =
      reportData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "athena-report";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
}
