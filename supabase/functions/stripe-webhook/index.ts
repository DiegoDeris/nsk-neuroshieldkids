// stripe-webhook — actualiza plan en DB tras eventos de Stripe
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-04-10" });
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal", ...extra };
}

// Idempotency: in-memory dedup (fast path) + DB persist (survives restarts)
const processedEvents = new Set<string>();

async function isEventProcessed(eventId: string): Promise<boolean> {
  if (processedEvents.has(eventId)) return true;
  // Check DB
  const r = await fetch(`${SB_URL}/rest/v1/processed_stripe_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`, {
    headers: sbHeaders({ "Prefer": "" }),
  });
  if (r.ok) {
    const rows = await r.json() as Array<{ event_id: string }>;
    return rows.length > 0;
  }
  return false;
}

async function markEventProcessed(eventId: string): Promise<void> {
  processedEvents.add(eventId);
  if (processedEvents.size > 500) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }
  // Persist to DB
  await fetch(`${SB_URL}/rest/v1/processed_stripe_events`, {
    method: "POST",
    headers: sbHeaders({ "Prefer": "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({ event_id: eventId }),
  });
}

async function upsertSub(userId: string, data: Record<string, unknown>) {
  // Single atomic upsert — requires user_id unique constraint on subscriptions table
  const r = await fetch(`${SB_URL}/rest/v1/subscriptions`, {
    method: "POST",
    headers: sbHeaders({ "Prefer": "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: userId, ...data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`DB upsert error: ${r.status} ${await r.text()}`);
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

  // Idempotency: check in-memory + DB
  if (await isEventProcessed(event.id)) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { "Content-Type": "application/json" } });
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

      // Map Stripe statuses: active→active, past_due→past_due, everything else→inactive
      const mappedStatus = sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "inactive";
      await upsertSub(userId, {
        plan,
        status: mappedStatus,
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

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string | null;
      if (!subId) return new Response("ok");
      const sub = await stripe.subscriptions.retrieve(subId);
      const userId = sub.metadata?.user_id;
      if (!userId) return new Response("ok");
      await upsertSub(userId, { status: "past_due" });
    }

    await markEventProcessed(event.id);
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook handler error:", e);
    return new Response(String(e), { status: 500 });
  }
});
