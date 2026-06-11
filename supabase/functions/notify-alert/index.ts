// notify-alert — envía email al padre cuando se crea una alerta crítica o moderada
// Invocado desde un Database Webhook (tabla alerts, evento INSERT)
// Requiere: RESEND_API_KEY en secrets de Supabase

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
// Secret compartido configurado en el Database Webhook de Supabase (header X-Webhook-Secret)
const WEBHOOK_SECRET = Deno.env.get("NOTIFY_ALERT_SECRET");

function sbHeaders() {
  return { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Verificar que el caller es el webhook interno de Supabase.
  // Fail-closed: si el secret no está configurado, se rechaza toda llamada
  // (antes, su ausencia desactivaba la verificación por completo).
  if (!WEBHOOK_SECRET) {
    console.error("notify-alert: NOTIFY_ALERT_SECRET no configurado — rechazando todas las llamadas");
    return new Response(JSON.stringify({ error: "service misconfigured" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const callerSecret = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (callerSecret !== WEBHOOK_SECRET) {
    console.warn("notify-alert: unauthorized caller");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    if (!RESEND_KEY) {
      console.warn("RESEND_API_KEY not configured — email skipped");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    // Webhook de Supabase envía { type, table, record, old_record, schema }
    const record = body.record ?? body;
    if (!record || typeof record !== "object") {
      return new Response(JSON.stringify({ error: "record requerido" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const { child_id, parent_id, severity, title, message } = record;
    if (!child_id || !parent_id || !severity || !title || !message) {
      return new Response(JSON.stringify({ error: "faltan campos requeridos: child_id, parent_id, severity, title, message" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Solo notificar alertas críticas y moderadas
    if (!["critical", "moderate"].includes(severity)) {
      return new Response(JSON.stringify({ ok: true, skipped: "low severity" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Obtener email del padre
    const profiles = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${parent_id}&select=email,full_name&limit=1`, { headers: sbHeaders() })
      .then(r => r.json())
      .catch(() => null);
    const parentEmail = profiles?.[0]?.email;
    const parentName = profiles?.[0]?.full_name ?? "Padre/Madre";
    if (!parentEmail) {
      console.warn("No email found for parent", parent_id);
      return new Response(JSON.stringify({ ok: true, skipped: "no email" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Obtener nombre del hijo
    const children = await fetch(`${SB_URL}/rest/v1/children?id=eq.${child_id}&select=name&limit=1`, { headers: sbHeaders() })
      .then(r => r.json())
      .catch(() => null);
    const childName = children?.[0]?.name ?? "tu hijo/a";

    const severityLabel = severity === "critical" ? "🔴 CRÍTICA" : "🟠 MODERADA";
    const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#2563eb;padding:16px 24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;margin:0;font-size:18px">NeuroShield Kids</h1>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:24px">
    <p style="color:#64748b;margin-top:0">Hola ${parentName},</p>
    <p>Se ha generado una alerta <strong>${severityLabel}</strong> para <strong>${childName}</strong>:</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
      <p style="font-weight:bold;margin:0 0 8px;color:#991b1b">${title}</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px">${message}</p>
    </div>
    <a href="https://nsk-neuroshieldkids.vercel.app/alerts" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ver alertas en el panel</a>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">NeuroShield Kids · No leer mensajes ni fotos · Solo patrones de uso digital</p>
  </div>
</div>`;

    const fromAddress = Deno.env.get("FROM_EMAIL") ?? "NeuroShield Kids <onboarding@resend.dev>";
    const emailBody = JSON.stringify({
      from: fromAddress,
      to: [parentEmail],
      subject: `[NSK] Alerta ${severityLabel} — ${childName}`,
      html,
    });

    // Reintento con backoff exponencial: hasta 3 intentos (0ms, 500ms, 1500ms)
    const RETRY_DELAYS_MS = [0, 500, 1500];
    let lastErr = "";
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      if (RETRY_DELAYS_MS[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: emailBody,
      });

      if (emailRes.ok) {
        return new Response(JSON.stringify({ ok: true, sent_to: parentEmail }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

      lastErr = await emailRes.text();
      console.warn(`Resend attempt ${attempt + 1} failed:`, emailRes.status, lastErr);
    }

    console.error("Resend error after retries:", lastErr);
    return new Response(JSON.stringify({ ok: false, error: lastErr }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-alert error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
