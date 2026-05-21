// Endpoint público de ingesta event-driven. Auth = ingest_token del hijo (no JWT).
// POST /ingest-usage  body: { token, events:[{app_name,duration_seconds,occurred_at?,event_type?,metadata?}] }
// Tras insertar: agrega métricas del día en background y EVALÚA REGLAS en tiempo casi real → genera alertas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IncomingEvent {
  app_name?: string;
  duration_seconds?: number;
  occurred_at?: string;
  event_type?: string;
  metadata?: Record<string, unknown>;
}

interface Rule {
  id: string;
  parent_id: string;
  child_id: string | null;
  name: string;
  rule_type: string;
  config: any;
  severity: "preventive" | "moderate" | "critical";
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
}

/**
 * Normaliza event_type al conjunto permitido por el CHECK constraint de la BD.
 * Garantiza que ningún insert viole la constraint independientemente del cliente.
 */
function normalizeEventType(raw: string): string {
  const t = String(raw).toLowerCase().trim();
  // Tipos nativos de BD
  if (["app_usage", "session_start", "session_end", "screen_on", "screen_off"].includes(t)) return t;
  // Aliases comunes → mapeados a tipos BD
  if (t === "app_open")    return "session_start";  // app_open cuenta como inicio de sesión
  if (t === "usage")       return "app_usage";
  if (t === "web_visit")   return "app_usage";
  return "app_usage"; // fallback seguro
}

async function evaluateRules(admin: any, childId: string, parentId: string, newEvents: any[]) {
  const { data: rules } = await admin
    .from("rules")
    .select("*")
    .eq("enabled", true)
    .eq("parent_id", parentId)
    .or(`child_id.eq.${childId},child_id.is.null`);

  if (!rules || rules.length === 0) return [];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const triggered: { rule: Rule; title: string; message: string }[] = [];

  // Una sola query para todos los eventos de hoy (evita N+1)
  const { data: dayEvents } = await admin
    .from("usage_events")
    .select("app_name,duration_seconds,occurred_at,event_type")
    .eq("child_id", childId)
    .gte("occurred_at", `${today}T00:00:00Z`)
    .lte("occurred_at", `${today}T23:59:59Z`);

  const events = dayEvents ?? [];
  const totalSec = events.reduce((a: number, e: any) => a + (e.duration_seconds || 0), 0);
  const perApp: Record<string, number> = {};
  for (const e of events) {
    if (!e.app_name) continue;
    perApp[e.app_name.toLowerCase()] = (perApp[e.app_name.toLowerCase()] || 0) + (e.duration_seconds || 0);
  }

  for (const r of rules as Rule[]) {
    // cooldown
    if (r.last_triggered_at) {
      const elapsed = (now.getTime() - new Date(r.last_triggered_at).getTime()) / 60000;
      if (elapsed < r.cooldown_minutes) continue;
    }

    let hit: { title: string; message: string } | null = null;

    switch (r.rule_type) {
      case "forbidden_app": {
        const apps: string[] = (r.config?.apps ?? []).map((a: string) => a.toLowerCase());
        const found = newEvents.find(e => e.app_name && apps.includes(String(e.app_name).toLowerCase()));
        if (found) hit = {
          title: `🚫 App prohibida detectada: ${found.app_name}`,
          message: `${r.name} — Se ha detectado uso de "${found.app_name}".`,
        };
        break;
      }
      case "daily_time_limit": {
        const limitMin = Number(r.config?.minutes ?? 120);
        const usedMin = Math.round(totalSec / 60);
        if (usedMin >= limitMin) hit = {
          title: `⏱️ Límite diario superado (${usedMin}/${limitMin} min)`,
          message: `${r.name} — Tiempo total hoy: ${usedMin} min. Límite: ${limitMin} min.`,
        };
        break;
      }
      case "app_time_limit": {
        const app = String(r.config?.app ?? "").toLowerCase();
        const limitMin = Number(r.config?.minutes ?? 60);
        const usedMin = Math.round((perApp[app] || 0) / 60);
        if (app && usedMin >= limitMin) hit = {
          title: `⏱️ Límite de ${r.config.app} superado (${usedMin}/${limitMin} min)`,
          message: `${r.name} — ${r.config.app}: ${usedMin} min hoy.`,
        };
        break;
      }
      case "restricted_hours": {
        const startH = Number(r.config?.start_hour ?? 22);
        const endH = Number(r.config?.end_hour ?? 7);
        const usedInRestricted = newEvents.find(e => {
          const h = new Date(e.occurred_at).getHours();
          return startH <= endH ? (h >= startH && h < endH) : (h >= startH || h < endH);
        });
        if (usedInRestricted) hit = {
          title: `🌙 Uso en horario restringido (${startH}h–${endH}h)`,
          message: `${r.name} — Actividad detectada a las ${new Date(usedInRestricted.occurred_at).toLocaleTimeString("es")}.`,
        };
        break;
      }
      case "session_burst": {
        const windowMin = Number(r.config?.window_minutes ?? 10);
        const maxSessions = Number(r.config?.max_sessions ?? 5);
        const cutoff = new Date(now.getTime() - windowMin * 60000);
        // Detecta tanto session_start/screen_on (eventos de sesión) como aperturas de app (app_usage en ventana corta)
        const recent = events.filter((e: any) =>
          ["session_start", "screen_on", "app_usage"].includes(e.event_type) &&
          new Date(e.occurred_at) >= cutoff
        );
        if (recent.length >= maxSessions) hit = {
          title: `📱 Uso compulsivo: ${recent.length} aperturas en ${windowMin} min`,
          message: `${r.name} — Posible patrón de uso ansioso.`,
        };
        break;
      }
    }

    if (hit) triggered.push({ rule: r, ...hit });
  }

  // Insertar alertas + actualizar cooldown (batch)
  if (triggered.length > 0) {
    await admin.from("alerts").insert(triggered.map(t => ({
      child_id: childId,
      parent_id: parentId,
      severity: t.rule.severity,
      title: t.title,
      message: t.message,
    })));
    await admin.from("rules").update({ last_triggered_at: now.toISOString() })
      .in("id", triggered.map(t => t.rule.id));
  }

  return triggered.map(t => ({ rule_id: t.rule.id, title: t.title }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    const eventsRaw = Array.isArray(body.events) ? body.events : (body.event ? [body.event] : []);

    if (!token || token.length < 16 || token.length > 128) {
      return new Response(JSON.stringify({ error: "token requerido" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (eventsRaw.length === 0 || eventsRaw.length > 500) {
      return new Response(JSON.stringify({ error: "events: 1..500" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: child, error: childErr } = await admin
      .from("children").select("id, parent_id").eq("ingest_token", token).maybeSingle();
    if (childErr) throw childErr;
    if (!child) {
      return new Response(JSON.stringify({ error: "token inválido" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = (eventsRaw as IncomingEvent[]).map((e) => {
      const dur = Math.max(0, Math.min(86400, Number(e.duration_seconds ?? 0) | 0));
      const type = normalizeEventType(String(e.event_type ?? "app_usage"));
      const occurred = e.occurred_at ? new Date(e.occurred_at) : new Date();
      const app = e.app_name ? String(e.app_name).slice(0, 80) : null;
      return {
        child_id: child.id,
        parent_id: child.parent_id,
        occurred_at: isNaN(occurred.getTime()) ? new Date().toISOString() : occurred.toISOString(),
        app_name: app,
        duration_seconds: dur,
        event_type: type,
        source: "api" as const,
        metadata: e.metadata && typeof e.metadata === "object" ? e.metadata : {},
      };
    });

    const { error: insErr } = await admin.from("usage_events").insert(rows);
    if (insErr) throw insErr;

    // Agregar métricas de forma NO BLOQUEANTE (fire-and-forget) — no añade latencia al cliente
    const days = Array.from(new Set(rows.map(r => r.occurred_at.slice(0, 10))));
    Promise.all(
      days.map(d => admin.rpc("aggregate_events_to_metric", { _child_id: child.id, _day: d }))
    ).catch(err => console.error("aggregate error (background):", err));

    // Actualizar last_ingest_at
    admin.from("children").update({ last_ingest_at: new Date().toISOString() }).eq("id", child.id)
      .then(() => {}).catch(() => {});

    // EVENT-DRIVEN: evaluar reglas en tiempo casi real
    const alerts = await evaluateRules(admin, child.id, child.parent_id, rows);

    return new Response(JSON.stringify({ ok: true, ingested: rows.length, days, alerts_triggered: alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ingest-usage error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
