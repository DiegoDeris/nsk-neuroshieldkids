// stripe-webhook — actualiza plan en DB tras eventos de Stripe
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-04-10" });
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders() {
  return { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" };
}

async function upsertSub(userId: string, data: Record<string, unknown>) {
  const existing = await fetch(`${SB_URL}/rest/v1/subscriptions?user_id=eq.${userId}&limit=1`, {
    headers: { ...sbHeaders(), "Prefer": "return=representation" },
  });
  if (!existing.ok) throw new Error(`DB read error: ${existing.status} ${await existing.text()}`);
  const rows = await existing.json();

  if (rows.length > 0) {
    const r = await fetch(`${SB_URL}/rest/v1/subscriptions?user_id=eq.${userId}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`DB patch error: ${r.status} ${await r.text()}`);
  } else {
    const r = await fetch(`${SB_URL}/rest/v1/subscriptions`, {
      method: "POST", headers: sbHeaders(), body: JSON.stringify({ user_id: userId, ...data, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`DB insert error: ${r.status} ${await r.text()}`);
  }
}

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("no signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error("webhook signature failed:", e);
    return new Response(`webhook error: ${e}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      if (!userId) return new Response("ok");
      const plan = session.metadata?.plan ?? "basic";
      const interval = session.metadata?.interval ?? "monthly";
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);

      await upsertSub(userId, {
        plan,
        status: "active",
        billing_interval: interval,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        stripe_price_id: sub.items.data[0]?.price.id,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      if (!userId) return new Response("ok");
      const plan = sub.metadata?.plan ?? "basic";
      const interval = sub.metadata?.interval ?? "monthly";

      await upsertSub(userId, {
        plan,
        status: sub.status === "active" ? "active" : "inactive",
        billing_interval: interval,
        stripe_subscription_id: sub.id,
        stripe_price_id: sub.items.data[0]?.price.id,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      if (!userId) return new Response("ok");

      await upsertSub(userId, { plan: "free", status: "inactive", stripe_subscription_id: null, current_period_end: null });
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook handler error:", e);
    return new Response(String(e), { status: 500 });
  }
});
