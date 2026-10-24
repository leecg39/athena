import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, invoices, organizations } from "@athena/db";
import { renderInvoicePdfBuffer } from "@athena/core/billing";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await getSettingsContext();
    if (!s.can("billing:read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const [[inv], [org]] = await Promise.all([
      db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, s.organizationId))),
      db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, s.organizationId)),
    ]);

    if (!inv) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const pdfBuffer = renderInvoicePdfBuffer({
      invoiceId: inv.id,
      stripeInvoiceId: inv.stripeInvoiceId,
      organizationName: org?.name ?? "Athenum Organization",
      description: inv.description ?? "Invoice",
      amountCents: inv.amountCents,
      currency: inv.currency,
      status: inv.status,
      issuedAt: inv.issuedAt ?? null,
    });

    const filename = (inv.stripeInvoiceId || `invoice-${inv.id.slice(0, 8)}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
}
