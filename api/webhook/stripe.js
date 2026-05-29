/**
 * Vercel serverless: POST /api/webhook/stripe
 *
 * Handles Stripe payment events:
 *   checkout.session.completed → create license key, write Supabase, send Resend email
 *   customer.subscription.deleted → downgrade org in Supabase
 *   invoice.payment_failed → send renewal-failure email
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// ── helpers ─────────────────────────────────────────────────────────────────

function generateLicenseKey() {
  const seg = () => crypto.randomBytes(4).toString("hex").toUpperCase();
  return `NDA-${seg()}-${seg()}-${seg()}`;
}

function planFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_PRO]:   { plan: "pro",  seats: 1,  label: "Pro ($50/mo)" },
    [process.env.STRIPE_PRICE_TEAM]:  { plan: "team", seats: 10, label: "Team 10-seat ($400/yr)" },
    [process.env.STRIPE_PRICE_DEPT]:  { plan: "dept", seats: 50, label: "Dept 50-seat ($1,500/yr)" },
  };
  return map[priceId] ?? { plan: "pro", seats: 1, label: "Pro" };
}

async function handleCheckoutCompleted(session) {
  const { customer, customer_email, metadata } = session;
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
  const priceId   = lineItems.data[0]?.price?.id;
  const { plan, seats, label } = planFromPriceId(priceId);

  const licenseKey = generateLicenseKey();
  const expiresAt  = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString(); // ~1 year

  // Write license to Supabase
  const { error } = await supabase.from("license_keys").insert({
    key:              licenseKey,
    plan,
    seats,
    stripe_customer:  customer,
    email:            customer_email,
    expires_at:       expiresAt,
    is_active:        true,
  });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);

  // Upgrade org record
  await supabase.from("organizations").upsert({
    stripe_customer: customer,
    email:           customer_email,
    plan,
    seats,
    license_key:     licenseKey,
    upgraded_at:     new Date().toISOString(),
  }, { onConflict: "stripe_customer" });

  // Send purchase confirmation + license key
  await resend.emails.send({
    from:    "NetDesign AI <noreply@netdesignai.com>",
    to:      customer_email,
    subject: `Your NetDesign AI license key — ${label}`,
    html: `
      <h2>Welcome to NetDesign AI ${plan.charAt(0).toUpperCase() + plan.slice(1)}!</h2>
      <p>Your license key:</p>
      <pre style="background:#0a0e1a;color:#00e5a0;padding:16px;border-radius:6px;font-size:18px;letter-spacing:2px;">${licenseKey}</pre>
      <h3>Activate your license</h3>
      <ul>
        <li><strong>Web app:</strong> Sign in at <a href="https://app.netdesignai.com">app.netdesignai.com</a> — your account is already upgraded.</li>
        <li><strong>Docker self-hosted:</strong> Set <code>NETDESIGN_LICENSE_KEY=${licenseKey}</code> in your <code>.env</code> file and restart the stack.</li>
      </ul>
      <p>Plan: <strong>${label}</strong> · Seats: <strong>${seats}</strong> · Renews: <strong>${new Date(expiresAt).toLocaleDateString()}</strong></p>
      <p style="color:#666;font-size:12px;">Reply to this email for support.</p>
    `,
  });
}

async function handleSubscriptionDeleted(subscription) {
  const customer = subscription.customer;
  await supabase
    .from("organizations")
    .update({ plan: "free", seats: 0 })
    .eq("stripe_customer", customer);
  await supabase
    .from("license_keys")
    .update({ is_active: false })
    .eq("stripe_customer", customer);
}

async function handlePaymentFailed(invoice) {
  const customer_email = invoice.customer_email;
  if (!customer_email) return;
  await resend.emails.send({
    from:    "NetDesign AI <noreply@netdesignai.com>",
    to:      customer_email,
    subject: "NetDesign AI — payment failed, action needed",
    html: `
      <h2>Payment failed</h2>
      <p>We couldn't charge your card for your NetDesign AI subscription. Your license will remain active for 7 days.</p>
      <p><a href="https://billing.stripe.com/p/login/test_xxx" style="background:#00e5a0;color:#000;padding:10px 20px;border-radius:4px;text-decoration:none;">Update payment method →</a></p>
    `,
  });
}

// ── handler ──────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  const sig     = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).json({ error: "Bad signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`Webhook handler error [${event.type}]:`, err);
    res.status(500).json({ error: "Handler failed" });
  }
}
