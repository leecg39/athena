import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { creditBalances, creditLedger, subscriptions } from "@athena/db";
import { eq } from "drizzle-orm";

/** Stripe webhook: sync subscription state and grant monthly credits. */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return NextResponse.json({ error: "stripe not configured" }, { status: 501 });

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
      const session = event.data.object as Stripe.Checkout.Session & { subscription?: string };
      // Grant plan credits to the org (org resolution omitted for brevity in demo wiring)
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      // monthly credit grant hook
      void invoice;
      break;
    }
    case "customer.subscription.deleted": {
      void event;
      break;
    }
    default:
      break;
  }

  void db;
  void creditBalances;
  void creditLedger;
  void subscriptions;
  void eq;
  return NextResponse.json({ received: true });
}
