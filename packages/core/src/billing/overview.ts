/** Billing overview for the settings page (plan, pools, ledger, invoices). */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type Db, creditBalances, creditLedger, groups, invoices, organizations, websites } from "@athena/db";
import { requirePermission } from "../org/access";
import { NotFoundError } from "../org/errors";
import { subscriptionRow } from "./apply";
import { isAddonId, type BillingLedgerItem, type BillingOverview } from "./catalog";

export async function getBillingOverview(db: Db, opts: { actorId: string; organizationId: string }): Promise<BillingOverview> {
  await requirePermission(db, opts.actorId, opts.organizationId, "billing:read");
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, opts.organizationId), isNull(organizations.deletedAt)));
  if (!org) throw new NotFoundError("Organization not found");
  const sub = await subscriptionRow(db, org.id);
  const [balances, sites, orgGroups, ledgerRows, invoiceRows] = await Promise.all([
    db.select().from(creditBalances).where(eq(creditBalances.organizationId, org.id)),
    db.select().from(websites).where(and(eq(websites.organizationId, org.id), isNull(websites.deletedAt))).orderBy(asc(websites.name)),
    db.select().from(groups).where(and(eq(groups.organizationId, org.id), isNull(groups.deletedAt))).orderBy(asc(groups.name)),
    db.select().from(creditLedger).where(eq(creditLedger.organizationId, org.id)).orderBy(desc(creditLedger.createdAt), desc(creditLedger.id)).limit(40),
    db.select().from(invoices).where(eq(invoices.organizationId, org.id)).orderBy(desc(invoices.issuedAt), desc(invoices.id)).limit(30),
  ]);
  const sum = (pred: (b: (typeof balances)[number]) => boolean) => balances.filter(pred).reduce((acc, b) => acc + Number(b.balance ?? 0), 0);
  const orgUnallocatedBalance = sum((b) => b.websiteId === null && b.groupId === null);
  const websitePools = sites.map((s) => ({ websiteId: s.id, websiteName: s.name, domain: s.domain, balance: sum((b) => b.websiteId === s.id && b.groupId === null) }));
  const groupPools = orgGroups.map((g) => ({ groupId: g.id, groupName: g.name, balance: sum((b) => b.groupId === g.id && b.websiteId === null) }));
  const totalWebsiteCredits = websitePools.reduce((a, b) => a + b.balance, 0);
  const totalGroupCredits = groupPools.reduce((a, b) => a + b.balance, 0);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const groupName = new Map(orgGroups.map((g) => [g.id, g.name]));
  const ledger: BillingLedgerItem[] = ledgerRows.map((l) => ({
    id: l.id,
    kind: l.kind,
    amount: l.amount,
    reason: l.reason,
    scopeType: l.websiteId ? "website" : l.groupId ? "group" : "organization",
    scopeLabel: l.websiteId ? `Website: ${siteName.get(l.websiteId) ?? "—"}` : l.groupId ? `Group: ${groupName.get(l.groupId) ?? "—"}` : "Organization Pool",
    websiteId: l.websiteId,
    groupId: l.groupId,
    createdAt: l.createdAt,
  }));
  return {
    organization: { id: org.id, name: org.name, plan: org.plan },
    subscription: {
      id: sub.id,
      plan: org.plan,
      status: sub.status,
      billingInterval: sub.billingInterval === "annual" ? "annual" : "monthly",
      addons: (Array.isArray(sub.addons) ? sub.addons : []).filter(isAddonId),
      monthlyCredits: sub.monthlyCredits,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
    },
    balances: { orgUnallocatedBalance, websitePools, groupPools, totalWebsiteCredits, totalGroupCredits, totalOrgWideCredits: orgUnallocatedBalance + totalWebsiteCredits + totalGroupCredits },
    ledger,
    invoices: invoiceRows.map((i) => ({ id: i.id, stripeInvoiceId: i.stripeInvoiceId, description: i.description || "Invoice", amountCents: i.amountCents, currency: i.currency, status: i.status, pdfUrl: `/api/billing/invoices/${i.id}/pdf`, issuedAt: i.issuedAt ?? null })),
  };
}
