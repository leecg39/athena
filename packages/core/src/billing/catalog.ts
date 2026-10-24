/** Plans, credit packs, add-ons and the billing overview shape. */
import { PLANS, type PlanTier } from "../index";

/** Models with an answer-collection adapter (the rest of the registry cannot be collected yet). */
const COLLECTED = new Set<string>(["chatgpt", "claude", "perplexity", "gemini", "grok", "deepseek"]);
const collectedCount = (models: readonly string[]) => models.filter((m) => COLLECTED.has(m)).length;

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
    modelsCount: collectedCount(PLANS.free.models),
    pitchLimit: 3,
    features: ["300 monthly AI answer credits (1 credit = 1 collected answer)", "ChatGPT, Perplexity and Gemini answers", "3 prospect pitches / month", "Olympus dashboard, Sources and CSV export"],
  },
  starter: {
    tier: "starter",
    label: "Starter",
    priceMonthlyUsd: 295,
    priceAnnualMonthlyUsd: 236,
    monthlyCredits: 3600,
    modelsCount: collectedCount(PLANS.starter.models),
    pitchLimit: 10,
    features: ["3,600 monthly AI answer credits", "Adds Claude, Grok and DeepSeek answers", "10 prospect pitches / month", "Content Hub publishing to 8 CMSs, Outreach and Site Health"],
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    priceMonthlyUsd: 1450,
    priceAnnualMonthlyUsd: 1160,
    monthlyCredits: 20000,
    modelsCount: collectedCount(PLANS.enterprise.models),
    pitchLimit: 100,
    features: ["20,000 monthly AI answer credits", "Agency groups with shared credit pools", "100 prospect pitches / month", "REST API, MCP server, BI connectors and custom roles"],
  },
};

export const CREDIT_PACK_CATALOG = [
  { id: "pack_1k", label: "+1,000 credits", credits: 1000, priceUsd: 79, amountCents: 7900, description: "1,000 AI answer credits" },
  { id: "pack_5k", label: "+5,000 credits", credits: 5000, priceUsd: 345, amountCents: 34500, description: "5,000 AI answer credits ($0.069/credit)" },
  { id: "pack_15k", label: "+15,000 credits", credits: 15000, priceUsd: 895, amountCents: 89500, description: "15,000 AI answer credits ($0.060/credit)" },
] as const;
export type CreditPackId = (typeof CREDIT_PACK_CATALOG)[number]["id"];

export const BILLING_ADDON_CATALOG = [
  { id: "api_mcp_addon", label: "REST API, MCP server and BI connectors", priceMonthlyUsd: 99, amountCents: 9900, bonusCredits: 500, description: "/api/v1, the MCP server and Looker Studio / Power BI feeds, plus 500 credits with each paid month." },
  { id: "pitch_pro_addon", label: "Pitch Pro", priceMonthlyUsd: 75, amountCents: 7500, bonusCredits: 500, description: "Extra pitch capacity for agencies, plus 500 credits with each paid month." },
] as const;
export type BillingAddonId = (typeof BILLING_ADDON_CATALOG)[number]["id"];

export const isPlanTier = (v: unknown): v is PlanTier => v === "free" || v === "starter" || v === "enterprise";
export const isPackId = (v: unknown): v is CreditPackId => CREDIT_PACK_CATALOG.some((p) => p.id === v);
export const isAddonId = (v: unknown): v is BillingAddonId => BILLING_ADDON_CATALOG.some((a) => a.id === v);

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
  /** paid (Stripe) | test (test mode, not charged) | void */
  status: string;
  pdfUrl: string;
  issuedAt: Date | null;
}

export interface BillingOverview {
  organization: { id: string; name: string; plan: PlanTier };
  subscription: {
    id: string;
    plan: PlanTier;
    status: "active" | "trialing" | "past_due" | "canceled";
    billingInterval: BillingInterval;
    addons: BillingAddonId[];
    monthlyCredits: number;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
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
