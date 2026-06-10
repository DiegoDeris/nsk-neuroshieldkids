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

interface ParsedRow {
  line: number; // número de línea en el CSV (1-based, incluyendo header)
  cols: number; // cantidad de columnas encontradas en esta fila
  row: Record<string, string>;
}

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
  const rows = lines.slice(1).map((line, idx) => {
    // simple CSV split (no campos con comas internas)
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string,string> = {};
    headers.forEach((h, i) => row[h] = cols[i] ?? "");
    return { line: idx + 2, cols: cols.length, row };
  });
  return { headers, rows };
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
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = user.id;

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

    const { headers, rows } = parseCSV(csv);
    if (rows.length === 0 || rows.length > 5000) {
      return new Response(JSON.stringify({ error: "CSV vacío o >5000 filas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const expectedCols = headers.length;
    const MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000; // ~2 años
    const FUTURE_SLACK_MS = 5 * 60 * 1000; // pequeña tolerancia de reloj
    const nowMs = Date.now();

    const errors: Array<{ line: number; reason: string }> = [];
    const events: Array<{
      child_id: string;
      parent_id: string;
      occurred_at: string;
      app_name: string | null;
      duration_seconds: number;
      event_type: "app_usage";
      source: "csv";
      metadata: Record<string, never>;
    }> = [];

    for (const { line, cols, row: r } of rows) {
      // (a) número de columnas debe coincidir con el header
      if (cols !== expectedCols) {
        errors.push({ line, reason: `número de columnas inválido (esperado ${expectedCols}, recibido ${cols})` });
        continue;
      }

      const app = (r.app ?? r.app_name ?? r.application ?? "").slice(0, 80) || null;
      const minutes = Number(r.minutes ?? r.duration_minutes ?? 0);
      const seconds = Number(r.duration_seconds ?? (isFinite(minutes) ? minutes * 60 : 0));
      const ts = r.timestamp || r.date || r.day || r.occurred_at;
      const occurred = ts ? new Date(ts) : new Date();

      if (!ts || isNaN(occurred.getTime())) {
        errors.push({ line, reason: "timestamp/fecha inválido o ausente" });
        continue;
      }

      // (b) timestamp dentro de un rango razonable: no futuro, no anterior a ~2 años
      const occurredMs = occurred.getTime();
      if (occurredMs > nowMs + FUTURE_SLACK_MS) {
        errors.push({ line, reason: "timestamp en el futuro" });
        continue;
      }
      if (occurredMs < nowMs - MAX_AGE_MS) {
        errors.push({ line, reason: "timestamp anterior a 2 años" });
        continue;
      }

      const durationSeconds = Math.max(0, Math.min(86400, seconds | 0));
      if (durationSeconds <= 0) {
        errors.push({ line, reason: "duration_seconds/minutes inválido o cero" });
        continue;
      }

      events.push({
        child_id: child.id,
        parent_id: child.parent_id,
        occurred_at: occurred.toISOString(),
        app_name: app,
        duration_seconds: durationSeconds,
        event_type: "app_usage",
        source: "csv",
        metadata: {},
      });
    }

    if (events.length === 0) {
      return new Response(JSON.stringify({ error: "No se encontraron filas válidas. Cabeceras esperadas: date,app,minutes", skipped: errors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    return new Response(JSON.stringify({ ok: true, ingested: events.length, days, skipped: errors, skipped_count: errors.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("import-csv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
