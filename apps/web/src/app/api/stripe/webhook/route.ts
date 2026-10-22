import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { processStripeWebhookEvent } from "@athena/core/billing";
import type { PlanTier } from "@athena/core";

/**
 * Stripe webhook endpoint: verifies `stripe-signature`, extracts `organizationId`
 * from session/subscription metadata, and delegates to `processStripeWebhookEvent`
 * for idempotent credit grants, subscription state sync, and invoice creation.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) {
    return NextResponse.json({ error: "stripe not configured" }, { status: 501 });
  }

  const stripe = new Stripe(key);
  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `signature: ${(err as Error).message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session & {
        subscription?: string | null;
      };
      const orgId = session.client_reference_id ?? session.metadata?.organizationId;
      if (orgId) {
        const rawPlan = session.metadata?.plan;
        const plan: PlanTier =
          rawPlan === "enterprise" ? "enterprise" : rawPlan === "free" ? "free" : "starter";
        await processStripeWebhookEvent(db, {
          id: event.id,
          type: event.type,
          organizationId: orgId,
          plan,
          amountCents: session.amount_total ?? 29500,
          stripeInvoiceId:
            typeof session.invoice === "string" ? session.invoice : `cs_${session.id}`,
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : undefined,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : undefined,
          description: `Stripe Checkout (${plan.toUpperCase()} Plan)`,
        });
      }
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | null;
      };
      const orgId = invoice.metadata?.organizationId;
      if (orgId) {
        await processStripeWebhookEvent(db, {
          id: event.id,
          type: event.type,
          organizationId: orgId,
          plan: "starter",
          amountCents: invoice.amount_paid ?? 29500,
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId:
            typeof invoice.subscription === "string" ? invoice.subscription : undefined,
          stripeCustomerId:
            typeof invoice.customer === "string" ? invoice.customer : undefined,
          description: "Stripe Subscription Renewal Invoice",
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.organizationId;
      if (orgId) {
        await processStripeWebhookEvent(db, {
          id: event.id,
          type: event.type,
          organizationId: orgId,
        });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
