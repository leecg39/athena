/**
 * Stripe Billing, Multi-Scope Credit System & Invoices Engine (Task 20):
 *  - Plans: Free ($0/mo, 300 credits), Starter ($295/mo, 3,600 credits), Enterprise ($1,450/mo, 20,000 credits)
 *  - Multi-Scope Credit Balances (`credit_balances`):
 *      1. Organization Unallocated Pool (`websiteId IS NULL AND groupId IS NULL`)
 *      2. Website Dedicated Pool (`websiteId IS NOT NULL AND groupId IS NULL`)
 *      3. Group Shared Pool (`groupId IS NOT NULL AND websiteId IS NULL`)
 *  - Credit Ledger (`credit_ledger`): immutable audit trail of grants, consumptions, refunds, and pool allocations
 *  - Credit Top-Up Packs (`pack_1k`, `pack_5k`, `pack_15k`) & API/MCP Add-ons (`api_mcp_addon`, `pitch_pro_addon`)
 *  - Idempotent Stripe Webhook processor (`processStripeWebhookEvent`) & `%PDF-1.4` Invoice PDF generator
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  type Db,
  creditBalances,
  creditLedger,
  groups,
  invoices,
  organizations,
  subscriptions,
  websites,
} from "@athena/db";
import { requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { PLANS, type PlanTier } from "../index";

export * from "./credits";

export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export interface BillingPlanCatalogItem {
  tier: PlanTier;
  label: string;
  priceMonthlyUsd: number;
  priceAnnualMonthlyUsd: number;
  monthlyCredits: number;
  modelsCount: number;
  pitchLimit: number;
  features: string[];
}

export const BILLING_PLAN_CATALOG: Record<PlanTier, BillingPlanCatalogItem> = {
  free: {
    tier: "free",
    label: "Free",
    priceMonthlyUsd: 0,
    priceAnnualMonthlyUsd: 0,
    monthlyCredits: 300,
    modelsCount: PLANS.free.models.length,
    pitchLimit: 3,
    features: [
      "300 monthly AI response credits",
      "5 core AI search models (ChatGPT, Perplexity, AI Overview, Gemini, Copilot)",
      "3 prospect pitch reports / month",
      "Olympus dashboard, Sources & CSV export",
    ],
  },
  starter: {
    tier: "starter",
    label: "Starter",
    priceMonthlyUsd: 295,
    priceAnnualMonthlyUsd: 236,
    monthlyCredits: 3600,
    modelsCount: PLANS.starter.models.length,
    pitchLimit: 10,
    features: [
      "3,600 monthly AI response credits ($295/mo)",
      "All 11 AI search engines (adds Claude, AI Mode, Grok, DeepSeek, Meta AI, Mistral)",
      "10 prospect pitch reports / month + AEO Content Rewrite Studio",
      "Content Hub CMS publishing, Outreach pipeline & 10-bot Site Health",
    ],
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    priceMonthlyUsd: 1450,
    priceAnnualMonthlyUsd: 1160,
    monthlyCredits: 20000,
    modelsCount: PLANS.enterprise.models.length,
    pitchLimit: 100,
    features: [
      "20,000 monthly AI response credits",
      "Multi-brand Agency Groups & Shared Credit Pools",
      "100 prospect pitch reports / month + white-label PDF export",
      "Public REST API (/api/v1), MCP Server, BI Connectors, Custom RBAC & SSO",
    ],
  },
};

export const CREDIT_PACK_CATALOG = [
  {
    id: "pack_1k",
    label: "+1,000 Credits Top-Up Pack",
    credits: 1000,
    priceUsd: 79,
    amountCents: 7900,
    description: "Instant 1,000 AI response credits (never expire while subscription is active)",
  },
  {
    id: "pack_5k",
    label: "+5,000 Credits Growth Pack",
    credits: 5000,
    priceUsd: 345,
    amountCents: 34500,
    description: "5,000 AI response credits ($0.069/credit — save 13%)",
  },
  {
    id: "pack_15k",
    label: "+15,000 Credits Scale Pack",
    credits: 15000,
    priceUsd: 895,
    amountCents: 89500,
    description: "15,000 AI response credits for high-frequency multi-brand tracking (save 24%)",
  },
] as const;

export type CreditPackId = (typeof CREDIT_PACK_CATALOG)[number]["id"];

export const BILLING_ADDON_CATALOG = [
  {
    id: "api_mcp_addon",
    label: "Public REST API, MCP Server & BI Connectors Add-on",
    priceMonthlyUsd: 99,
    amountCents: 9900,
    bonusCredits: 500,
    description:
      "Unlocks high-throughput /api/v1/* endpoints, ChatGPT/Claude MCP Server, and Looker Studio / Power BI feeds (+500 monthly credits).",
  },
  {
    id: "pitch_pro_addon",
    label: "Agency Pitch Deck Pro Add-on",
    priceMonthlyUsd: 75,
    amountCents: 7500,
    bonusCredits: 500,
    description:
      "Unlocks agency prospect pitch templates, custom PDF export branding, and +500 bonus monthly credits.",
  },
] as const;

export type BillingAddonId = (typeof BILLING_ADDON_CATALOG)[number]["id"];

export interface WebsiteCreditPoolItem {
  websiteId: string;
  websiteName: string;
  domain: string;
  balance: number;
}

export interface GroupCreditPoolItem {
  groupId: string;
  groupName: string;
  balance: number;
}

export interface BillingLedgerItem {
  id: string;
  kind: string;
  amount: number;
  reason: string | null;
  scopeType: "organization" | "website" | "group";
  scopeLabel: string;
  websiteId: string | null;
  groupId: string | null;
  createdAt: Date;
}

export interface BillingInvoiceItem {
  id: string;
  stripeInvoiceId: string | null;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  pdfUrl: string;
  issuedAt: Date;
}

export interface BillingOverview {
  organization: {
    id: string;
    name: string;
    plan: PlanTier;
  };
  subscription: {
    id: string;
    plan: PlanTier;
    status: "active" | "trialing" | "past_due" | "canceled";
    billingInterval: BillingInterval;
    addons: BillingAddonId[];
    monthlyCredits: number;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: Date;
  };
  balances: {
    orgUnallocatedBalance: number;
    websitePools: WebsiteCreditPoolItem[];
    groupPools: GroupCreditPoolItem[];
    totalWebsiteCredits: number;
    totalGroupCredits: number;
    totalOrgWideCredits: number;
  };
  ledger: BillingLedgerItem[];
  invoices: BillingInvoiceItem[];
}

async function ensureSubscriptionRow(db: Db, organizationId: string, orgPlan: PlanTier) {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (existing) return existing;

  const catalog = BILLING_PLAN_CATALOG[orgPlan] ?? BILLING_PLAN_CATALOG.free;
  const periodEnd = new Date(Date.now() + 30 * 86_400_000);

  const [created] = await db
    .insert(subscriptions)
    .values({
      organizationId,
      plan: orgPlan,
      status: "active",
      billingInterval: "monthly",
      addons: [],
      monthlyCredits: catalog.monthlyCredits,
      currentPeriodEnd: periodEnd,
    })
    .returning();

  return created!;
}

export async function getBillingOverview(
  db: Db,
  opts: { actorId: string; organizationId: string },
): Promise<BillingOverview> {
  await requirePermission(db, opts.actorId, opts.organizationId, "billing:read");

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, opts.organizationId), isNull(organizations.deletedAt)));
  if (!org) throw new NotFoundError("Organization not found");

  const sub = await ensureSubscriptionRow(db, org.id, org.plan);

  const [allBalances, orgSites, orgGroups, ledgerRows, invoiceRows] = await Promise.all([
    db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.organizationId, org.id)),
    db
      .select()
      .from(websites)
      .where(and(eq(websites.organizationId, org.id), isNull(websites.deletedAt)))
      .orderBy(asc(websites.name)),
    db
      .select()
      .from(groups)
      .where(and(eq(groups.organizationId, org.id), isNull(groups.deletedAt)))
      .orderBy(asc(groups.name)),
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, org.id))
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(40),
    db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, org.id))
      .orderBy(desc(invoices.issuedAt), desc(invoices.id))
      .limit(30),
  ]);

  const orgBalRow = allBalances.find((b) => b.websiteId === null && b.groupId === null);
  const orgUnallocatedBalance = Number(orgBalRow?.balance ?? 0);

  const websitePools: WebsiteCreditPoolItem[] = orgSites.map((s) => {
    const bal = allBalances
      .filter((b) => b.websiteId === s.id && b.groupId === null)
      .reduce((acc, b) => acc + Number(b.balance ?? 0), 0);
    return {
      websiteId: s.id,
      websiteName: s.name,
      domain: s.domain,
      balance: bal,
    };
  });

  const groupPools: GroupCreditPoolItem[] = orgGroups.map((g) => {
    const bal = allBalances
      .filter((b) => b.groupId === g.id && b.websiteId === null)
      .reduce((acc, b) => acc + Number(b.balance ?? 0), 0);
    return {
      groupId: g.id,
      groupName: g.name,
      balance: bal,
    };
  });

  const totalWebsiteCredits = websitePools.reduce((a, b) => a + b.balance, 0);
  const totalGroupCredits = groupPools.reduce((a, b) => a + b.balance, 0);
  const totalOrgWideCredits = orgUnallocatedBalance + totalWebsiteCredits + totalGroupCredits;

  const siteNameById = new Map(orgSites.map((s) => [s.id, s.name]));
  const groupNameById = new Map(orgGroups.map((g) => [g.id, g.name]));

  const ledger: BillingLedgerItem[] = ledgerRows.map((l) => {
    let scopeType: BillingLedgerItem["scopeType"] = "organization";
    let scopeLabel = "Organization Pool";
    if (l.websiteId) {
      scopeType = "website";
      scopeLabel = `Website: ${siteNameById.get(l.websiteId) ?? "Workspace"}`;
    } else if (l.groupId) {
      scopeType = "group";
      scopeLabel = `Group: ${groupNameById.get(l.groupId) ?? "Portfolio"}`;
    }
    return {
      id: l.id,
      kind: l.kind,
      amount: l.amount,
      reason: l.reason,
      scopeType,
      scopeLabel,
      websiteId: l.websiteId,
      groupId: l.groupId,
      createdAt: l.createdAt,
    };
  });

  const validAddons = new Set<string>(BILLING_ADDON_CATALOG.map((a) => a.id));
  const rawAddons = Array.isArray(sub.addons) ? sub.addons : [];
  const addons = rawAddons.filter((a): a is BillingAddonId => validAddons.has(a));

  return {
    organization: {
      id: org.id,
      name: org.name,
      plan: org.plan,
    },
    subscription: {
      id: sub.id,
      plan: org.plan,
      status: sub.status,
      billingInterval: sub.billingInterval === "annual" ? "annual" : "monthly",
      addons,
      monthlyCredits: sub.monthlyCredits,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      currentPeriodEnd: sub.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000),
    },
    balances: {
      orgUnallocatedBalance,
      websitePools,
      groupPools,
      totalWebsiteCredits,
      totalGroupCredits,
      totalOrgWideCredits,
    },
    ledger,
    invoices: invoiceRows.map((i) => ({
      id: i.id,
      stripeInvoiceId: i.stripeInvoiceId,
      description:
        i.description ||
        (i.amountCents === 29500
          ? "Starter Plan Subscription ($295/mo)"
          : "Athenum Subscription & Credits Invoice"),
      amountCents: i.amountCents,
      currency: i.currency,
      status: i.status,
      pdfUrl: `/api/billing/invoices/${i.id}/pdf`,
      issuedAt: i.issuedAt ?? new Date(),
    })),
  };
}

const changePlanSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  plan: z.enum(["free", "starter", "enterprise"]),
  billingInterval: z.enum(BILLING_INTERVALS).default("monthly"),
});

/**
 * Upgrades or changes an organization's subscription plan (`Free` / `Starter $295` / `Enterprise`),
 * grants the plan's monthly credit allowance when upgrading to a paid tier, and issues an invoice.
 */
export async function changeSubscriptionPlan(
  db: Db,
  rawInput: z.input<typeof changePlanSchema>,
): Promise<{
  plan: PlanTier;
  billingInterval: BillingInterval;
  monthlyCredits: number;
  orgBalance: number;
  invoiceId: string | null;
}> {
  const parsed = changePlanSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid plan selection");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  const catalog = BILLING_PLAN_CATALOG[input.plan];

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + input.organizationId}))`,
    );

    const [org] = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, input.organizationId), isNull(organizations.deletedAt)));
    if (!org) throw new NotFoundError("Organization not found");

    await tx
      .update(organizations)
      .set({ plan: input.plan })
      .where(eq(organizations.id, org.id));

    const existingSub = await ensureSubscriptionRow(tx as unknown as Db, org.id, org.plan);
    const periodDays = input.billingInterval === "annual" ? 365 : 30;
    const nextPeriodEnd = new Date(Date.now() + periodDays * 86_400_000);

    await tx
      .update(subscriptions)
      .set({
        plan: input.plan,
        status: "active",
        billingInterval: input.billingInterval,
        monthlyCredits: catalog.monthlyCredits,
        stripeCustomerId: existingSub.stripeCustomerId ?? `cus_${org.id.slice(0, 8)}`,
        stripeSubscriptionId:
          input.plan === "free"
            ? null
            : (existingSub.stripeSubscriptionId ?? `sub_${randomBytes(6).toString("hex")}`),
        currentPeriodEnd: nextPeriodEnd,
      })
      .where(eq(subscriptions.id, existingSub.id));

    let invoiceId: string | null = null;

    if (input.plan !== "free") {
      // Grant monthly plan allowance to org credit pool
      const updatedBal = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${catalog.monthlyCredits}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, org.id),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (updatedBal.length === 0) {
        await tx.insert(creditBalances).values({
          organizationId: org.id,
          websiteId: null,
          groupId: null,
          balance: catalog.monthlyCredits,
        });
      }

      await tx.insert(creditLedger).values({
        organizationId: org.id,
        websiteId: null,
        groupId: null,
        kind: "grant",
        amount: catalog.monthlyCredits,
        reason: `${catalog.label} plan (${input.billingInterval}) monthly credit grant (+${catalog.monthlyCredits.toLocaleString()} credits)`,
      });

      const amountCents =
        input.billingInterval === "annual"
          ? catalog.priceAnnualMonthlyUsd * 12 * 100
          : catalog.priceMonthlyUsd * 100;

      const description =
        input.billingInterval === "annual"
          ? `${catalog.label} Plan — Annual Subscription ($${catalog.priceAnnualMonthlyUsd}/mo × 12)`
          : `${catalog.label} Plan — Monthly Subscription ($${catalog.priceMonthlyUsd}/mo)`;

      const [inv] = await tx
        .insert(invoices)
        .values({
          organizationId: org.id,
          stripeInvoiceId: `in_plan_${randomBytes(8).toString("hex")}`,
          description,
          amountCents,
          currency: "usd",
          status: "paid",
          issuedAt: new Date(),
        })
        .returning({ id: invoices.id });

      invoiceId = inv!.id;
      await tx
        .update(invoices)
        .set({ pdfUrl: `/api/billing/invoices/${inv!.id}/pdf` })
        .where(eq(invoices.id, inv!.id));
    }

    const [finalBal] = await tx
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, org.id),
          isNull(creditBalances.websiteId),
          isNull(creditBalances.groupId),
        ),
      );

    await logActivity(tx, {
      organizationId: org.id,
      userId: input.actorId,
      entityType: "subscription",
      entityId: existingSub.id,
      change: "plan_changed",
      before: { plan: org.plan },
      after: {
        plan: input.plan,
        billingInterval: input.billingInterval,
        monthlyCredits: catalog.monthlyCredits,
        invoiceId,
      },
    });

    return {
      plan: input.plan,
      billingInterval: input.billingInterval,
      monthlyCredits: catalog.monthlyCredits,
      orgBalance: Number(finalBal?.balance ?? 0),
      invoiceId,
    };
  });
}

const purchasePackSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  packId: z.enum(["pack_1k", "pack_5k", "pack_15k"]),
  targetScope: z.enum(["organization", "website", "group"]).default("organization"),
  targetWebsiteId: z.string().uuid().optional().nullable(),
  targetGroupId: z.string().uuid().optional().nullable(),
});

/**
 * Purchases an additional credit pack (`+1,000`, `+5,000`, or `+15,000` credits)
 * and credits the selected pool (Organization, Website, or Group), issuing a paid invoice.
 */
export async function purchaseCreditPack(
  db: Db,
  rawInput: z.input<typeof purchasePackSchema>,
): Promise<{
  packId: CreditPackId;
  creditsAdded: number;
  newPoolBalance: number;
  invoiceId: string;
}> {
  const parsed = purchasePackSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid credit pack selection");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  const pack = CREDIT_PACK_CATALOG.find((p) => p.id === input.packId);
  if (!pack) throw new DomainError("Unknown credit pack");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + input.organizationId}))`,
    );

    let websiteId: string | null = null;
    let groupId: string | null = null;
    let poolLabel = "Organization Pool";

    if (input.targetScope === "website" && input.targetWebsiteId) {
      const [site] = await tx
        .select()
        .from(websites)
        .where(
          and(
            eq(websites.id, input.targetWebsiteId),
            eq(websites.organizationId, input.organizationId),
            isNull(websites.deletedAt),
          ),
        );
      if (!site) throw new NotFoundError("Target website not found in organization");
      websiteId = site.id;
      poolLabel = `Website: ${site.name}`;
    } else if (input.targetScope === "group" && input.targetGroupId) {
      const [grp] = await tx
        .select()
        .from(groups)
        .where(
          and(
            eq(groups.id, input.targetGroupId),
            eq(groups.organizationId, input.organizationId),
            isNull(groups.deletedAt),
          ),
        );
      if (!grp) throw new NotFoundError("Target group not found in organization");
      groupId = grp.id;
      poolLabel = `Group: ${grp.name}`;
    }

    const poolCondition = and(
      eq(creditBalances.organizationId, input.organizationId),
      websiteId ? eq(creditBalances.websiteId, websiteId) : isNull(creditBalances.websiteId),
      groupId ? eq(creditBalances.groupId, groupId) : isNull(creditBalances.groupId),
    );

    const [existingBal] = await tx.select().from(creditBalances).where(poolCondition);
    let newPoolBalance = 0;

    if (existingBal) {
      const [upd] = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${pack.credits}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.id, existingBal.id))
        .returning({ balance: creditBalances.balance });
      newPoolBalance = upd!.balance;
    } else {
      const [ins] = await tx
        .insert(creditBalances)
        .values({
          organizationId: input.organizationId,
          websiteId,
          groupId,
          balance: pack.credits,
        })
        .returning({ balance: creditBalances.balance });
      newPoolBalance = ins!.balance;
    }

    await tx.insert(creditLedger).values({
      organizationId: input.organizationId,
      websiteId,
      groupId,
      kind: "grant",
      amount: pack.credits,
      reason: `${pack.label} purchased → ${poolLabel}`,
    });

    const [inv] = await tx
      .insert(invoices)
      .values({
        organizationId: input.organizationId,
        stripeInvoiceId: `in_pack_${randomBytes(8).toString("hex")}`,
        description: `${pack.label} (${pack.credits.toLocaleString()} credits → ${poolLabel})`,
        amountCents: pack.amountCents,
        currency: "usd",
        status: "paid",
        issuedAt: new Date(),
      })
      .returning({ id: invoices.id });

    await tx
      .update(invoices)
      .set({ pdfUrl: `/api/billing/invoices/${inv!.id}/pdf` })
      .where(eq(invoices.id, inv!.id));

    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      websiteId,
      entityType: "credit_pack",
      entityId: inv!.id,
      change: "purchased",
      after: {
        packId: pack.id,
        credits: pack.credits,
        amountCents: pack.amountCents,
        poolLabel,
      },
    });

    return {
      packId: pack.id,
      creditsAdded: pack.credits,
      newPoolBalance,
      invoiceId: inv!.id,
    };
  });
}

const toggleAddonSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  addonId: z.enum(["api_mcp_addon", "pitch_pro_addon"]),
  enabled: z.boolean(),
});

/**
 * Enables or disables a recurring billing add-on (e.g. `Public REST API, MCP Server & BI Connectors Add-on` $99/mo).
 * Enabling an add-on grants its bonus monthly credits and records an invoice.
 */
export async function toggleBillingAddon(
  db: Db,
  rawInput: z.input<typeof toggleAddonSchema>,
): Promise<{
  addons: BillingAddonId[];
  bonusCreditsGranted: number;
  invoiceId: string | null;
}> {
  const parsed = toggleAddonSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid add-on selection");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  const addon = BILLING_ADDON_CATALOG.find((a) => a.id === input.addonId);
  if (!addon) throw new DomainError("Unknown billing add-on");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + input.organizationId}))`,
    );

    const [org] = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, input.organizationId), isNull(organizations.deletedAt)));
    if (!org) throw new NotFoundError("Organization not found");

    const sub = await ensureSubscriptionRow(tx as unknown as Db, org.id, org.plan);
    const currentAddons = new Set<string>(Array.isArray(sub.addons) ? sub.addons : []);
    const wasEnabled = currentAddons.has(addon.id);

    if (input.enabled) {
      currentAddons.add(addon.id);
    } else {
      currentAddons.delete(addon.id);
    }

    const nextAddons = Array.from(currentAddons).filter((a): a is BillingAddonId =>
      BILLING_ADDON_CATALOG.some((c) => c.id === a),
    );

    await tx
      .update(subscriptions)
      .set({ addons: nextAddons })
      .where(eq(subscriptions.id, sub.id));

    let bonusCreditsGranted = 0;
    let invoiceId: string | null = null;

    if (input.enabled && !wasEnabled) {
      bonusCreditsGranted = addon.bonusCredits;
      await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${addon.bonusCredits}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, org.id),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        );

      await tx.insert(creditLedger).values({
        organizationId: org.id,
        websiteId: null,
        groupId: null,
        kind: "grant",
        amount: addon.bonusCredits,
        reason: `${addon.label} activated (+${addon.bonusCredits} bonus credits)`,
      });

      const [inv] = await tx
        .insert(invoices)
        .values({
          organizationId: org.id,
          stripeInvoiceId: `in_addon_${randomBytes(8).toString("hex")}`,
          description: `${addon.label} ($${addon.priceMonthlyUsd}/mo)`,
          amountCents: addon.amountCents,
          currency: "usd",
          status: "paid",
          issuedAt: new Date(),
        })
        .returning({ id: invoices.id });

      invoiceId = inv!.id;
      await tx
        .update(invoices)
        .set({ pdfUrl: `/api/billing/invoices/${inv!.id}/pdf` })
        .where(eq(invoices.id, inv!.id));
    }

    await logActivity(tx, {
      organizationId: org.id,
      userId: input.actorId,
      entityType: "billing_addon",
      entityId: sub.id,
      change: input.enabled ? "enabled" : "disabled",
      after: { addonId: addon.id, enabled: input.enabled, nextAddons },
    });

    return {
      addons: nextAddons,
      bonusCreditsGranted,
      invoiceId,
    };
  });
}

const allocateWebsiteCreditsSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  websiteId: z.string().uuid(),
  amount: z.number().int().min(1, "Amount must be at least 1 credit").max(1_000_000),
  direction: z.enum(["to_website", "to_org"]),
  reason: z.string().trim().max(240).optional(),
});

/**
 * Atomically allocates credits between the Organization Unallocated Pool and a specific
 * Website Dedicated Credit Pool (`credit_balances.website_id`), recording paired ledger rows.
 */
export async function allocateWebsiteCredits(
  db: Db,
  rawInput: z.input<typeof allocateWebsiteCreditsSchema>,
): Promise<{ orgBalance: number; websiteBalance: number }> {
  const parsed = allocateWebsiteCreditsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid website credit allocation");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + input.organizationId}))`,
    );

    const [site] = await tx
      .select()
      .from(websites)
      .where(
        and(
          eq(websites.id, input.websiteId),
          eq(websites.organizationId, input.organizationId),
          isNull(websites.deletedAt),
        ),
      );
    if (!site) throw new NotFoundError("Website not found");

    const [existingSiteBal] = await tx
      .select()
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, input.organizationId),
          eq(creditBalances.websiteId, site.id),
          isNull(creditBalances.groupId),
        ),
      );

    let siteBalId = existingSiteBal?.id;
    if (!siteBalId) {
      const [inserted] = await tx
        .insert(creditBalances)
        .values({
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          balance: 0,
        })
        .returning({ id: creditBalances.id });
      siteBalId = inserted!.id;
    }

    if (input.direction === "to_website") {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient organization unallocated credits");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.id, siteBalId))
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Dedicated credit allocation to website "${site.name}"`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: `Allocated to website: ${site.name}`,
        },
        {
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: note,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        websiteId: site.id,
        userId: input.actorId,
        entityType: "website_credits",
        entityId: site.id,
        change: "allocated_to_website",
        after: { amount: input.amount, websiteBalance: credited[0]!.balance },
      });

      return {
        orgBalance: deducted[0]!.balance,
        websiteBalance: credited[0]!.balance,
      };
    } else {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(creditBalances.id, siteBalId), gte(creditBalances.balance, input.amount)))
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient website dedicated credits to return to organization");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        )
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Returned website credits from "${site.name}" to org pool`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: note,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: `Returned from website: ${site.name}`,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        websiteId: site.id,
        userId: input.actorId,
        entityType: "website_credits",
        entityId: site.id,
        change: "returned_to_org",
        after: { amount: input.amount, websiteBalance: deducted[0]!.balance },
      });

      return {
        orgBalance: credited[0]?.balance ?? 0,
        websiteBalance: deducted[0]!.balance,
      };
    }
  });
}

/**
 * Idempotent Stripe webhook event processor.
 * Deduplicates by `stripeInvoiceId` / `event.id` inside an advisory-locked transaction
 * so replayed webhook deliveries never double-grant credits or duplicate invoices.
 */
export async function processStripeWebhookEvent(
  db: Db,
  event: {
    id: string;
    type: string;
    organizationId: string;
    plan?: PlanTier;
    credits?: number;
    amountCents?: number;
    stripeInvoiceId?: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    description?: string;
  },
): Promise<{ duplicate: boolean; processed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"stripe_wh:" + event.organizationId}))`,
    );

    const dedupeInvoiceId = event.stripeInvoiceId || `evt_${event.id}`;
    const existingInv = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.stripeInvoiceId, dedupeInvoiceId))
      .limit(1);

    if (existingInv.length > 0) {
      return { duplicate: true, processed: false };
    }

    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const targetPlan = event.plan ?? "starter";
      const creditsToGrant =
        event.credits ?? BILLING_PLAN_CATALOG[targetPlan]?.monthlyCredits ?? 3600;
      const amountCents = event.amountCents ?? 29500;

      if (event.plan) {
        await tx
          .update(organizations)
          .set({ plan: event.plan })
          .where(eq(organizations.id, event.organizationId));

        const sub = await ensureSubscriptionRow(
          tx as unknown as Db,
          event.organizationId,
          event.plan,
        );
        await tx
          .update(subscriptions)
          .set({
            plan: event.plan,
            status: "active",
            monthlyCredits: BILLING_PLAN_CATALOG[event.plan].monthlyCredits,
            stripeSubscriptionId: event.stripeSubscriptionId ?? sub.stripeSubscriptionId,
            stripeCustomerId: event.stripeCustomerId ?? sub.stripeCustomerId,
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
          })
          .where(eq(subscriptions.id, sub.id));
      }

      await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${creditsToGrant}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, event.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        );

      await tx.insert(creditLedger).values({
        organizationId: event.organizationId,
        websiteId: null,
        groupId: null,
        kind: "grant",
        amount: creditsToGrant,
        reason: event.description || `Stripe webhook (${event.type}) credit grant`,
      });

      const [inv] = await tx
        .insert(invoices)
        .values({
          organizationId: event.organizationId,
          stripeInvoiceId: dedupeInvoiceId,
          description: event.description || `Stripe Invoice (${event.type})`,
          amountCents,
          currency: "usd",
          status: "paid",
          issuedAt: new Date(),
        })
        .returning({ id: invoices.id });

      await tx
        .update(invoices)
        .set({ pdfUrl: `/api/billing/invoices/${inv!.id}/pdf` })
        .where(eq(invoices.id, inv!.id));

      return { duplicate: false, processed: true };
    }

    if (event.type === "customer.subscription.deleted") {
      await tx
        .update(organizations)
        .set({ plan: "free" })
        .where(eq(organizations.id, event.organizationId));

      await tx
        .update(subscriptions)
        .set({ plan: "free", status: "canceled", monthlyCredits: 300 })
        .where(eq(subscriptions.organizationId, event.organizationId));

      return { duplicate: false, processed: true };
    }

    return { duplicate: false, processed: false };
  });
}

function escapePdfText(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Generates a standards-compliant `%PDF-1.4` binary invoice document.
 */
export function renderInvoicePdfBuffer(input: {
  invoiceId: string;
  stripeInvoiceId: string | null;
  organizationName: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  issuedAt: Date;
}): Buffer {
  const lines = [
    "ATHENUM - TAX INVOICE & RECEIPT",
    `Invoice ID: ${input.stripeInvoiceId || input.invoiceId}`,
    `Billed To: ${input.organizationName}`,
    `Issue Date: ${input.issuedAt.toISOString().slice(0, 10)}`,
    `Status: ${input.status.toUpperCase()}`,
    "------------------------------------------------------------",
    `Line Item: ${input.description}`,
    `Total Amount: $${(input.amountCents / 100).toFixed(2)} ${input.currency.toUpperCase()}`,
    "------------------------------------------------------------",
    "Thank you for subscribing to Athenum AI Search Intelligence.",
  ];

  const streamOps: string[] = ["BT", "/F1 14 Tf", "50 740 Td"];
  lines.forEach((line, idx) => {
    if (idx === 1) streamOps.push("/F1 10 Tf");
    streamOps.push(`(${escapePdfText(line)}) Tj`);
    streamOps.push("0 -20 Td");
  });
  streamOps.push("ET");
  const contentStream = streamOps.join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}
