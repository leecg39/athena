import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import {
  changeSubscriptionPlan,
  purchaseCreditPack,
  toggleBillingAddon,
  type BillingAddonId,
  type BillingInterval,
  type CreditPackId,
} from "@athena/core/billing";
import type { PlanTier } from "@athena/core";
import { getSettingsContext } from "@/lib/settings-context";

/**
 * Stripe Checkout endpoint for subscription upgrades (`starter` / `enterprise`),
 * credit top-up packs (`pack_1k` / `pack_5k` / `pack_15k`), and add-ons (`api_mcp_addon` / `pitch_pro_addon`).
 * When `STRIPE_SECRET_KEY` is configured, creates a hosted Stripe Checkout Session with `organizationId` metadata.
 * When running locally without Stripe API keys, executes the atomic billing mutation directly and redirects to `/settings/billing?success=1`.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await getSettingsContext();
    if (!s.can("billing:write")) {
      return NextResponse.json({ error: "Forbidden: billing:write required" }, { status: 403 });
    }

    const body = (await req.json()) as {
      kind?: "plan" | "pack" | "addon";
      plan?: PlanTier;
      billingInterval?: BillingInterval;
      packId?: CreditPackId;
      addonId?: BillingAddonId;
    };

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      if (body.kind === "pack" && body.packId) {
        const res = await purchaseCreditPack(db, {
          actorId: s.user.id,
          organizationId: s.organizationId,
          packId: body.packId,
          targetScope: "organization",
        });
        return NextResponse.json({
          mode: "local",
          url: `${req.nextUrl.origin}/settings/billing?success=1`,
          result: res,
        });
      }

      if (body.kind === "addon" && body.addonId) {
        const res = await toggleBillingAddon(db, {
          actorId: s.user.id,
          organizationId: s.organizationId,
          addonId: body.addonId,
          enabled: true,
        });
        return NextResponse.json({
          mode: "local",
          url: `${req.nextUrl.origin}/settings/billing?success=1`,
          result: res,
        });
      }

      const targetPlan: PlanTier = body.plan ?? "starter";
      const res = await changeSubscriptionPlan(db, {
        actorId: s.user.id,
        organizationId: s.organizationId,
        plan: targetPlan,
        billingInterval: body.billingInterval ?? "monthly",
      });
      return NextResponse.json({
        mode: "local",
        url: `${req.nextUrl.origin}/settings/billing?success=1`,
        result: res,
      });
    }

    const stripe = new Stripe(key);
    const price =
      body.billingInterval === "annual"
        ? process.env.STRIPE_PRICE_STARTER_ANNUAL
        : process.env.STRIPE_PRICE_STARTER_MONTHLY;

    if (!price) {
      return NextResponse.json({ error: "Stripe price ID not configured" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: body.kind === "pack" ? "payment" : "subscription",
      client_reference_id: s.organizationId,
      metadata: {
        organizationId: s.organizationId,
        plan: body.plan ?? "starter",
        packId: body.packId ?? "",
        addonId: body.addonId ?? "",
      },
      line_items: [{ price, quantity: 1 }],
      success_url: `${req.nextUrl.origin}/settings/billing?success=1`,
      cancel_url: `${req.nextUrl.origin}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to initialize checkout" },
      { status: 400 },
    );
  }
}
