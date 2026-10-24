/**
 * Billing test mode: exercise plan, pack and add-on flows without Stripe.
 * Only outside production and only with BILLING_TEST_MODE=true; every change
 * is recorded as "test mode — not charged" with no amount.
 */
import { z } from "zod";
import { type Db } from "@athena/db";
import { requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";
import type { PlanTier } from "../index";
import { BILLING_ADDON_CATALOG, BILLING_INTERVALS, BILLING_PLAN_CATALOG, CREDIT_PACK_CATALOG } from "./catalog";
import { grantOrgCredits, lockOrg, recordInvoice, setAddon, setPlan, subscriptionRow } from "./apply";

type Env = Record<string, string | undefined>;

export function testBillingEnabled(env: Env = process.env): boolean {
  return env.BILLING_TEST_MODE === "true" && env.NODE_ENV !== "production";
}

function assertTestMode(env?: Env) {
  if (!testBillingEnabled(env)) throw new DomainError("Payments go through Stripe Checkout; billing test mode is not enabled.");
}

const RANK: Record<PlanTier, number> = { free: 0, starter: 1, enterprise: 2 };
const planSchema = z.object({ plan: z.enum(["free", "starter", "enterprise"]), billingInterval: z.enum(BILLING_INTERVALS).default("monthly") });

export async function testChangePlan(db: Db, input: { actorId: string; organizationId: string; plan: string; billingInterval?: string; env?: Env }) {
  assertTestMode(input.env);
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("Invalid plan selection");
  const { plan, billingInterval } = parsed.data;
  await requirePermission(db, input.actorId, input.organizationId, "billing:write");
  return db.transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const previous = (await subscriptionRow(tx, input.organizationId)).plan;
    await setPlan(tx, { organizationId: input.organizationId, plan, billingInterval, stripeSubscriptionId: null });
    const catalog = BILLING_PLAN_CATALOG[plan];
    // the allowance comes with an upgrade, not with re-selecting the same plan
    const creditsGranted = RANK[plan] > RANK[previous] ? catalog.monthlyCredits : 0;
    if (creditsGranted) await grantOrgCredits(tx, input.organizationId, creditsGranted, `${catalog.label} plan (test mode — not charged)`);
    if (plan !== previous && plan !== "free") await recordInvoice(tx, input.organizationId, { kind: "test" }, `${catalog.label} plan (${billingInterval})`);
    await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, entityType: "subscription", change: "test_plan_changed", before: { plan: previous }, after: { plan, billingInterval, creditsGranted } });
    return { plan, previous, creditsGranted };
  });
}

export async function testBuyPack(db: Db, input: { actorId: string; organizationId: string; packId: string; env?: Env }) {
  assertTestMode(input.env);
  const pack = CREDIT_PACK_CATALOG.find((p) => p.id === input.packId);
  if (!pack) throw new DomainError("Unknown credit pack");
  await requirePermission(db, input.actorId, input.organizationId, "billing:write");
  return db.transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const balance = await grantOrgCredits(tx, input.organizationId, pack.credits, `${pack.label} credit pack (test mode — not charged)`);
    await recordInvoice(tx, input.organizationId, { kind: "test" }, `${pack.label} credit pack`);
    await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, entityType: "credit_pack", change: "test_purchase", after: { packId: pack.id, credits: pack.credits } });
    return { creditsAdded: pack.credits, orgBalance: balance };
  });
}

/** Add-ons switch features only; their monthly credits come with paid Stripe invoices. */
export async function testToggleAddon(db: Db, input: { actorId: string; organizationId: string; addonId: string; enabled: boolean; env?: Env }) {
  assertTestMode(input.env);
  const addon = BILLING_ADDON_CATALOG.find((a) => a.id === input.addonId);
  if (!addon) throw new DomainError("Unknown billing add-on");
  await requirePermission(db, input.actorId, input.organizationId, "billing:write");
  return db.transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const addons = await setAddon(tx, input.organizationId, addon.id, input.enabled);
    await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, entityType: "billing_addon", change: input.enabled ? "test_enabled" : "test_disabled", after: { addonId: addon.id } });
    return { addons };
  });
}
