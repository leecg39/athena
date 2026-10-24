import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { processStripeWebhookEvent } from "@athena/core/billing";
import { normalizeStripeEvent, stripeClient } from "@/lib/stripe-billing";

/**
 * Stripe webhook: verifies the signature, maps the event to a billing change
 * and applies it once (paid invoices and packs are deduplicated by their ids).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "stripe not configured" }, { status: 501 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const change = normalizeStripeEvent(event);
  if (!change) return NextResponse.json({ received: true, ignored: event.type });
  const outcome = await processStripeWebhookEvent(db, change);
  if (!outcome.processed) console.warn("[stripe] event not applied", event.type, event.id, outcome.reason);
  return NextResponse.json({ received: true, ...outcome });
}
