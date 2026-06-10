// sync-subscription — verifica la sesión de Stripe inmediatamente tras el checkout
// y actualiza el plan en DB sin esperar al webhook.
// POST { session_id: string }  — requiere Authorization: Bearer <user_jwt>
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) return json({ error: "Stripe no configurado" }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "auth" }, 401);

  let body: { session_id?: string };
  try { body = await req.json(); } catch { return json({ error: "body inválido" }, 400); }

  const { session_id } = body;
  if (!session_id) return json({ error: "session_id requerido" }, 400);

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

    // Recuperar la sesión de Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    // Verificar que la sesión pertenece al usuario autenticado
    if (session.metadata?.user_id !== user.id) {
      return json({ error: "session no pertenece al usuario" }, 403);
    }

    // Solo procesar si el pago fue completado
    if (session.payment_status !== "paid") {
      return json({ ok: false, reason: "pago no completado", status: session.payment_status });
    }

    const plan = session.metadata?.plan ?? "basic";
    const interval = session.metadata?.interval ?? "monthly";
    const sub = session.subscription as Stripe.Subscription | null;

    await admin.from("subscriptions").upsert({
      user_id: user.id,
      plan,
      status: "active",
      billing_interval: interval,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: sub?.id ?? null,
      stripe_price_id: sub?.items?.data[0]?.price?.id ?? null,
      current_period_end: sub ? new Date(sub.current_period_end * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    console.log(`sync-subscription: user ${user.id} → plan ${plan} activo`);
    return json({ ok: true, plan, status: "active" });
  } catch (e) {
    console.error("sync-subscription error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
