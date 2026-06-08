// create-checkout — crea sesión de Stripe Checkout
// POST { plan: "basic"|"premium", interval: "monthly"|"annual" }
// Requiere: Authorization: Bearer <user_jwt>

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-04-10" });
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://nsk-neuroshieldkids.vercel.app";

// Price IDs de Stripe — se rellenan cuando Diego pase las claves
const PRICE_IDS: Record<string, string> = {
  "basic_monthly":   Deno.env.get("STRIPE_PRICE_BASIC_MONTHLY") ?? "",
  "basic_annual":    Deno.env.get("STRIPE_PRICE_BASIC_ANNUAL") ?? "",
  "premium_monthly": Deno.env.get("STRIPE_PRICE_PREMIUM_MONTHLY") ?? "",
  "premium_annual":  Deno.env.get("STRIPE_PRICE_PREMIUM_ANNUAL") ?? "",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function getUser(authHeader: string | null) {
  if (!authHeader) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { "apikey": SB_KEY, "Authorization": authHeader },
  });
  if (!r.ok) return null;
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const user = await getUser(req.headers.get("Authorization"));
    if (!user?.id) return json({ error: "no autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const plan: string = body.plan ?? "basic";
    const interval: string = body.interval ?? "monthly";
    const priceKey = `${plan}_${interval}`;
    const priceId = PRICE_IDS[priceKey];

    if (!priceId) return json({ error: `precio no configurado: ${priceKey}` }, 400);

    // Buscar o crear customer de Stripe
    const subRes = await fetch(`${SB_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=stripe_customer_id&limit=1`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` },
    });
    const subs = await subRes.json();
    let customerId: string | undefined = subs[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/dashboard?checkout=success&plan=${plan}`,
      cancel_url: `${APP_URL}/pricing?checkout=cancelled`,
      metadata: { user_id: user.id, plan, interval },
      subscription_data: { metadata: { user_id: user.id, plan, interval } },
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: String(e) }, 500);
  }
});
