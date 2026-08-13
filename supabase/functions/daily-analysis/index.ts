// Cron diario 08:00 — agrega eventos del día anterior, ejecuta el motor clínico
// y dispara alertas para todos los hijos con datos.
//
// v3: la heurística local desaparece. El juicio de riesgo lo emite el motor
// determinista compartido (_shared/clinicalEngine.ts), el mismo que usa el
// análisis bajo demanda, así que ambos caminos dan exactamente el mismo
// resultado para los mismos datos. Gemini pasa a redactar.
import { createClient } from "npm:@supabase/supabase-js@2";
import { runClinicalEngine, ENGINE_VERSION } from "../_shared/clinicalEngine.ts";
import type { EngineResult } from "../_shared/clinicalEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Narrative {
  explanation: string;
  detected_patterns: string[];
  actions: string[];
}

/**
 * Pide a Gemini que traduzca el resultado del motor a lenguaje de padre.
 *
 * Nunca lanza: si la IA falla, devuelve una redacción construida a partir de
 * la evidencia que el motor ya ha calculado. El análisis no se pierde jamás
 * por un problema de la IA, que es exactamente lo que ocurría en v2.
 */
async function writeNarrative(
  apiKey: string | undefined,
  child: { name?: string; age?: number },
  engine: EngineResult,
): Promise<Narrative> {
  const fallback = (): Narrative => {
    const top = engine.evidence[0];
    const level = engine.risk_level === "high"
      ? "alto" : engine.risk_level === "medium" ? "moderado" : "bajo";
    return {
      explanation: top
        ? `Se ha detectado principalmente: ${top.claim.toLowerCase()} (${top.data_point}). `
          + `Nivel de riesgo ${level}, confianza ${engine.confidence}%.`
        : `No se han detectado señales destacables. Nivel de riesgo ${level}.`,
      detected_patterns: engine.evidence.slice(0, 3).map((e) => e.claim),
      actions: [],
    };
  };

  if (!apiKey) return fallback();

  const dimText = Object.entries(engine.dimensions)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}/100`)
    .join("\n");
  const evidenceText = engine.evidence.map((e) => `- ${e.claim} → ${e.data_point}`).join("\n");

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "system",
            content: "Traduces un análisis conductual YA CALCULADO a lenguaje claro para un padre. "
              + "Las puntuaciones y la evidencia vienen dadas: no las recalcules ni las contradigas. "
              + "Nunca diagnostiques: habla de señales, no de trastornos. Español, cercano, sin alarmismo.",
          },
          {
            role: "user",
            content: `Niño/a: ${child.name}, ${child.age} años.\n`
              + `Puntuación ${engine.emotional_score}/100, riesgo ${engine.risk_level}, `
              + `confianza ${engine.confidence}%.\n\nDIMENSIONES:\n${dimText}\n\n`
              + `EVIDENCIA MEDIDA:\n${evidenceText || "- Sin señales destacables"}\n\n`
              + (engine.refer_to_professional ? `DERIVACIÓN: ${engine.referral_reason}\n` : "")
              + `Redacta la explicación y las acciones.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_narrative",
            parameters: {
              type: "object",
              properties: {
                explanation: { type: "string" },
                detected_patterns: { type: "array", maxItems: 3, items: { type: "string" } },
                actions: { type: "array", maxItems: 3, items: { type: "string" } },
              },
              required: ["explanation", "detected_patterns", "actions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_narrative" } },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return fallback();
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    return {
      explanation: parsed.explanation || fallback().explanation,
      detected_patterns: Array.isArray(parsed.detected_patterns) ? parsed.detected_patterns : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    clearTimeout(timeout);
    return fallback();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verificar CRON_SECRET para prevenir invocaciones no autorizadas (fail-closed)
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (!CRON_SECRET) {
    console.error("CRON_SECRET no configurado — rechazando invocación");
    return new Response(JSON.stringify({ error: "server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const day = yesterday.toISOString().slice(0, 10);

    // Hijos con eventos ayer
    const nextDay = new Date(yesterday); nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    const { data: childrenWithEvents } = await admin
      .from("usage_events")
      .select("child_id")
      .gte("occurred_at", `${day}T00:00:00Z`)
      .lt("occurred_at", `${nextDayStr}T00:00:00Z`);

    const allChildIds = Array.from(new Set((childrenWithEvents ?? []).map((r: any) => r.child_id)));

    // Solo procesar hijos de usuarios con plan premium activo
    const premiumParents = new Set<string>();
    if (allChildIds.length > 0) {
      const { data: premiumSubs } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("plan", "premium")
        .eq("status", "active");
      (premiumSubs ?? []).forEach((s: any) => premiumParents.add(s.user_id));
    }

    // Filtrar hijos: obtener parent_id y filtrar por plan
    const childIds: string[] = [];
    if (allChildIds.length > 0) {
      const { data: childRows } = await admin
        .from("children")
        .select("id,parent_id")
        .in("id", allChildIds);
      (childRows ?? []).forEach((c: any) => {
        if (premiumParents.has(c.parent_id)) childIds.push(c.id);
      });
    }

    const results: any[] = [];
    let failureCount = 0;

    for (const cid of childIds) {
      try {
        // Reagregar
        await admin.rpc("aggregate_events_to_metric", { _child_id: cid, _day: day });

        const { data: child } = await admin.from("children").select("*").eq("id", cid).maybeSingle();
        const { data: metric } = await admin.from("usage_metrics")
          .select("*").eq("child_id", cid).eq("metric_date", day).maybeSingle();
        if (!child || !metric) continue;

        // Historial de 28 días. Necesita app_breakdown y behavioral_signals:
        // sin ellos el motor no puede calcular líneas base ni detectar
        // aislamiento, compulsividad ni puntos de cambio.
        const { data: histMetrics } = await admin.from("usage_metrics")
          .select("total_minutes, night_minutes, sessions, metric_date, app_breakdown, behavioral_signals")
          .eq("child_id", cid)
          .lt("metric_date", day)
          .order("metric_date", { ascending: false })
          .limit(28);
        const history = histMetrics ?? [];

        // ── El motor determinista decide ─────────────────────────────────────
        const engine = runClinicalEngine({
          age: Number(child.age ?? 12),
          today: {
            metric_date: metric.metric_date,
            total_minutes: Number(metric.total_minutes ?? 0),
            night_minutes: Number(metric.night_minutes ?? 0),
            sessions: Number(metric.sessions ?? 0),
            dominant_app: metric.dominant_app ?? null,
            app_breakdown: metric.app_breakdown ?? null,
            behavioral_signals: metric.behavioral_signals ?? null,
          },
          history: history.map((h: any) => ({
            metric_date: h.metric_date,
            total_minutes: Number(h.total_minutes ?? 0),
            night_minutes: Number(h.night_minutes ?? 0),
            sessions: Number(h.sessions ?? 0),
            app_breakdown: h.app_breakdown ?? null,
            behavioral_signals: h.behavioral_signals ?? null,
          })),
        });

        // Evitar análisis duplicado si ya existe un score de hoy generado por cron
        const { data: existingScore } = await admin.from("emotional_scores")
          .select("id")
          .eq("child_id", cid)
          .gte("created_at", `${day}T00:00:00Z`)
          .limit(1)
          .maybeSingle();
        if (existingScore) {
          console.log(`Skipping ${cid} — ya analizado hoy`);
          continue;
        }

        // ── La IA solo redacta ───────────────────────────────────────────────
        // Antes, si la IA fallaba se hacía `continue` y el niño se quedaba SIN
        // análisis ese día. Ahora el motor ya ha decidido, así que el análisis
        // se guarda igualmente con una redacción de reserva.
        const narrative = await writeNarrative(GEMINI_API_KEY, child, engine);

        await admin.from("emotional_scores").insert([{
          child_id: cid, parent_id: child.parent_id,
          score: engine.emotional_score,
          risk_level: engine.risk_level,
          patterns: {
            summary_patterns: narrative.detected_patterns,
            dimensions: engine.dimensions,
            unavailable_dimensions: engine.unavailable_dimensions,
            confidence: engine.confidence,
            severity_tier: engine.severity_tier,
            evidence: engine.evidence.map((e) => ({ claim: e.claim, data_point: e.data_point })),
            clinical_domains: engine.clinical_domains,
            change_point: engine.change_point,
            refer_to_professional: engine.refer_to_professional,
            referral_reason: engine.referral_reason,
            trace: engine.trace,
            engine_version: ENGINE_VERSION,
          },
          explanation: narrative.explanation,
          actions: narrative.actions,
          source_metric_id: metric.id,
        }]);

        if (narrative.actions.length > 0) {
          await admin.from("recommendations").insert(narrative.actions.map((a: string) => ({
            child_id: cid, parent_id: child.parent_id,
            title: a, body: narrative.explanation, category: engine.risk_level,
          })));
        }

        // Alertas: score > 60, riesgo alto, o derivación recomendada.
        const sevMap: Record<string, string> = { high: "critical", medium: "moderate", low: "preventive" };
        const shouldAlert = engine.emotional_score > 60
          || engine.risk_level === "high"
          || engine.refer_to_professional;

        let mediumCooldownOk = false;
        if (engine.risk_level === "medium" && engine.emotional_score <= 60) {
          const { count } = await admin.from("alerts")
            .select("id", { count: "exact", head: true })
            .eq("child_id", cid)
            .gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString());
          mediumCooldownOk = (count ?? 0) === 0;
        }

        if (shouldAlert || mediumCooldownOk) {
          // La alerta cita la evidencia concreta, no un número abstracto.
          const topEvidence = engine.evidence[0];
          const detail = topEvidence ? `${topEvidence.claim} (${topEvidence.data_point}).` : "";
          await admin.from("alerts").insert([{
            child_id: cid, parent_id: child.parent_id,
            severity: sevMap[engine.risk_level] ?? "preventive",
            title: `${child.name}: ${topEvidence?.claim ?? `puntuación ${engine.emotional_score}`}`,
            message: `${detail} ${narrative.explanation}`.trim(),
          }]);
        }

        results.push({
          child_id: cid,
          score: engine.emotional_score,
          risk: engine.risk_level,
          confidence: engine.confidence,
          engine: ENGINE_VERSION,
        });
      } catch (childErr) {
        console.error(`Error procesando hijo ${cid}:`, childErr);
        failureCount++;
        try {
          const { data: childRow } = await admin.from("children").select("parent_id").eq("id", cid).maybeSingle();
          await admin.from("cron_failures").insert([{
            job_name: "daily-analysis",
            error: childErr instanceof Error ? childErr.message : String(childErr),
            context: { child_id: cid, parent_id: childRow?.parent_id ?? null, day },
          }]);
        } catch (logErr) {
          console.error("No se pudo registrar cron_failures:", logErr);
        }
      }
    }

    // Alerta al operador si la tasa de fallo supera el umbral
    const totalProcessed = childIds.length;
    const FAILURE_RATE_THRESHOLD = 0.2;
    if (totalProcessed > 0 && (failureCount / totalProcessed) > FAILURE_RATE_THRESHOLD) {
      try {
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        if (RESEND_API_KEY) {
          const fromAddress = Deno.env.get("FROM_EMAIL") ?? "NeuroShield Kids <onboarding@resend.dev>";
          const rate = ((failureCount / totalProcessed) * 100).toFixed(1);
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: fromAddress,
              to: "deriscars10@gmail.com",
              subject: "⚠️ daily-analysis: tasa de fallo elevada",
              html: `<p>El cron <strong>daily-analysis</strong> (${day}) registró una tasa de fallo elevada.</p>
<ul>
  <li>Fallos: ${failureCount}</li>
  <li>Total procesados: ${totalProcessed}</li>
  <li>Tasa: ${rate}%</li>
  <li>Timestamp: ${new Date().toISOString()}</li>
</ul>`,
            }),
          });
        } else {
          console.warn("RESEND_API_KEY no configurada — alerta de tasa de fallo omitida");
        }
      } catch (alertErr) {
        console.error("Error enviando alerta de tasa de fallo:", alertErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, day, processed: results.length, failures: failureCount, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("daily-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
