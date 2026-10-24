/** Single-page %PDF-1.4 invoice. Only Stripe-paid invoices are titled as receipts. */

function escapePdfText(s: string): string {
  return s.replace(/[—–]/g, "-").replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const TITLES: Record<string, string> = { paid: "ATHENUM - RECEIPT", test: "ATHENUM - TEST MODE (NOT CHARGED, NOT A RECEIPT)", void: "ATHENUM - VOID (NOT CHARGED, NOT A RECEIPT)" };

export function renderInvoicePdfBuffer(input: { invoiceId: string; stripeInvoiceId: string | null; organizationName: string; description: string; amountCents: number; currency: string; status: string; issuedAt: Date | null }): Buffer {
  const lines = [
    TITLES[input.status] ?? `ATHENUM - INVOICE (${input.status.toUpperCase()})`,
    `Invoice: ${input.stripeInvoiceId || input.invoiceId}`,
    `Billed to: ${input.organizationName}`,
    `Date: ${input.issuedAt ? input.issuedAt.toISOString().slice(0, 10) : "-"}`,
    `Status: ${input.status.toUpperCase()}`,
    "------------------------------------------------------------",
    `Item: ${input.description}`,
    `Amount: ${(input.amountCents / 100).toFixed(2)} ${input.currency.toUpperCase()}`,
  ];
  const ops = ["BT", "/F1 14 Tf", "50 740 Td", ...lines.flatMap((line, i) => [...(i === 1 ? ["/F1 10 Tf"] : []), `(${escapePdfText(line)}) Tj`, "0 -20 Td"]), "ET"];
  const stream = ops.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  const header = "%PDF-1.4\n";
  const offsets = objects.reduce<number[]>((acc, _o, i) => [...acc, i === 0 ? Buffer.byteLength(header) : acc[i - 1]! + Buffer.byteLength(objects[i - 1]!)], []);
  const body = header + objects.join("");
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  return Buffer.from(`${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF\n`, "utf8");
}
