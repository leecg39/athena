import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";

/** Stripe checkout for plan upgrades and credit packs. */
export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "stripe not configured", mode: "demo" }, { status: 501 });
  }
  const stripe = new Stripe(key);
  const { plan } = (await req.json()) as { plan: "starter" | "credits" };
  const price =
    plan === "starter"
      ? process.env.STRIPE_PRICE_STARTER_MONTHLY
      : process.env.STRIPE_PRICE_STARTER_ANNUAL;
  if (!price) return NextResponse.json({ error: "price not configured" }, { status: 400 });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${req.nextUrl.origin}/settings/billing?success=1`,
    cancel_url: `${req.nextUrl.origin}/settings/billing`,
  });
  return NextResponse.json({ url: session.url });
}
