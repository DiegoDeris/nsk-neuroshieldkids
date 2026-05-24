// Importa CSV de Family Link / Screen Time export.
// Formatos aceptados (cabeceras flexibles):
//   date,app,minutes            (estilo Family Link)
//   date,app,duration_minutes
//   timestamp,app_name,duration_seconds,event_type
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseCSV(text: string): Record<string,string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    // simple CSV split (no campos con comas internas)
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string,string> = {};
    headers.forEach((h, i) => row[h] = cols[i] ?? "");
    return row;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const child_id = String(body.child_id ?? "");
    const csv = String(body.csv ?? "");
    if (!child_id || !csv || csv.length > 2_000_000) {
      return new Response(JSON.stringify({ error: "child_id y csv requeridos (<2MB)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: child } = await admin.from("children").select("id, parent_id").eq("id", child_id).maybeSingle();
    if (!child || child.parent_id !== userId) {
      return new Response(JSON.stringify({ error: "Hijo no autorizado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = parseCSV(csv);
    if (rows.length === 0 || rows.length > 5000) {
      return new Response(JSON.stringify({ error: "CSV vacío o >5000 filas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const events = rows.map(r => {
      const app = (r.app ?? r.app_name ?? r.application ?? "").slice(0, 80) || null;
      const minutes = Number(r.minutes ?? r.duration_minutes ?? 0);
      const seconds = Number(r.duration_seconds ?? (isFinite(minutes) ? minutes * 60 : 0));
      const ts = r.timestamp || r.date || r.day;
      const occurred = ts ? new Date(ts) : new Date();
      return {
        child_id: child.id,
        parent_id: child.parent_id,
        occurred_at: isNaN(occurred.getTime()) ? new Date().toISOString() : occurred.toISOString(),
        app_name: app,
        duration_seconds: Math.max(0, Math.min(86400, seconds | 0)),
        event_type: "app_usage" as const,
        source: "csv" as const,
        metadata: {},
      };
    }).filter(e => e.duration_seconds > 0);

    if (events.length === 0) {
      return new Response(JSON.stringify({ error: "No se encontraron filas válidas. Cabeceras esperadas: date,app,minutes" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Insertar en lotes
    const chunk = 500;
    for (let i = 0; i < events.length; i += chunk) {
      const { error } = await admin.from("usage_events").insert(events.slice(i, i + chunk));
      if (error) throw error;
    }
    const days = Array.from(new Set(events.map(e => e.occurred_at.slice(0, 10))));
    for (const d of days) {
      await admin.rpc("aggregate_events_to_metric", { _child_id: child.id, _day: d });
    }
    await admin.from("children").update({ last_ingest_at: new Date().toISOString() }).eq("id", child.id);

    return new Response(JSON.stringify({ ok: true, ingested: events.length, days }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("import-csv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
