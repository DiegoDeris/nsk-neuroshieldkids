// predict-trends v2 — pronóstico determinista + IA solo como capa de redacción.
//
// QUÉ CAMBIA RESPECTO A v1
//
// v1 le pedía a Gemini que predijera las puntuaciones futuras del niño a 3, 7
// y 30 días, con intervalos y escenarios. El modelo se los inventaba: dos
// ejecuciones con los mismos datos daban cifras distintas. Y si la IA no
// respondía, se guardaba en la base de datos una predicción de relleno
// (puntuación 50, riesgo medio) indistinguible de una real.
//
// v2 calcula el pronóstico con un motor determinista y auditable
// (_shared/forecastEngine.ts). Si no hay serie suficiente, no se predice nada
// y se dice por qué. Nunca se guarda una predicción inventada.
import { createClient } from "npm:@supabase/supabase-js@2";
import { runClinicalEngine } from "../_shared/clinicalEngine.ts";
import { runForecast, FORECAST_VERSION } from "../_shared/forecastEngine.ts";
import type { DayMetric } from "../_shared/clinicalEngine.ts";
import type { ForecastResult, ScorePoint } from "../_shared/forecastEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { child_id } = await req.json();
    if (!child_id) throw new Error("child_id requerido");

    // ── Auth y plan ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "auth" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: child } = await admin.from("children").select("*").eq("id", child_id).maybeSingle();
    if (!child || child.parent_id !== user.id) return json({ error: "forbidden" }, 403);

    const { data: sub } = await admin.from("subscriptions")
      .select("plan,status").eq("user_id", user.id).maybeSingle();
    if (!sub || !["active", "past_due"].includes(sub.status) || sub.plan !== "premium") {
      return json({ error: "Esta función requiere plan Premium." }, 403);
    }

    // ── Datos ────────────────────────────────────────────────────────────────
    const { data: metricsRaw } = await admin.from("usage_metrics")
      .select("*").eq("child_id", child_id)
      .order("metric_date", { ascending: false }).limit(30);
    const { data: scoresRaw } = await admin.from("emotional_scores")
      .select("score,risk_level,patterns,created_at").eq("child_id", child_id)
      .order("created_at", { ascending: false }).limit(30);

    const metrics = (metricsRaw ?? []) as Array<Record<string, unknown>>;
    const scores = (scoresRaw ?? []) as Array<Record<string, unknown>>;

    const toDayMetric = (m: Record<string, unknown>): DayMetric => ({
      metric_date: m.metric_date as string | undefined,
      total_minutes: Number(m.total_minutes ?? 0),
      night_minutes: Number(m.night_minutes ?? 0),
      sessions: Number(m.sessions ?? 0),
      dominant_app: (m.dominant_app ?? null) as string | null,
      app_breakdown: (m.app_breakdown ?? null) as Record<string, number> | null,
      behavioral_signals: (m.behavioral_signals ?? null) as DayMetric["behavioral_signals"],
    });

    const today = metrics.length ? toDayMetric(metrics[0]) : undefined;
    const metricHistory = metrics.slice(1).map(toDayMetric);
    const age = Number(child.age ?? 12);

    // Estado clínico de hoy. Si la fuente no mide el dispositivo, no hay nada
    // que proyectar: una tendencia sobre datos que no miden es ruido con forma
    // de gráfica.
    const todayEngine = today
      ? runClinicalEngine({ age, today, history: metricHistory })
      : null;

    if (!todayEngine || !todayEngine.assessable) {
      return json({
        forecastable: false,
        not_forecastable_reason: todayEngine?.not_assessable_reason
          ?? "Todavía no hay datos medidos del dispositivo sobre los que proyectar.",
        engine_version: FORECAST_VERSION,
        horizons: [],
        early_warnings: [],
        counterfactual: null,
        confidence: 0,
      });
    }

    // Serie de puntuaciones: solo días realmente evaluados.
    const history: ScorePoint[] = scores
      .filter((s) => typeof s.score === "number")
      .map((s) => ({
        date: String(s.created_at).slice(0, 10),
        score: Number(s.score),
      }));

    // ── PASO 1: el motor determinista calcula el pronóstico ──────────────────
    const forecast = runForecast({
      history,
      today,
      metricHistory,
      age,
      todayEngine,
    });

    // Sin serie suficiente no se predice ni se guarda nada.
    if (!forecast.forecastable) {
      return json({ ...forecast });
    }

    // ── PASO 2: la IA solo redacta lo ya calculado ───────────────────────────
    const narrative = await writeNarrative(
      Deno.env.get("GEMINI_API_KEY"),
      { name: String(child.name ?? ""), age },
      forecast,
    );

    // ── Persistencia: cifras del motor, texto del modelo ─────────────────────
    const h7 = forecast.horizons.find((h) => h.days === 7) ?? forecast.horizons[0];

    const { data: saved } = await admin.from("predictions").insert([{
      parent_id: user.id,
      child_id,
      predicted_score: h7.expected_score,
      predicted_risk: h7.risk_level,
      trend: forecast.trend,
      drivers: narrative.drivers,
      prevention_plan: narrative.prevention_plan,
      confidence: forecast.confidence,
      explanation: narrative.explanation,
    }]).select().single();

    // ── Retos: derivados de umbrales reales, no de sugerencias genéricas ─────
    if (narrative.prevention_plan.length > 0) {
      const { data: existingQ } = await admin.from("quests")
        .select("title").eq("child_id", child_id)
        .eq("category", "prevention").eq("status", "active");
      const existing = new Set((existingQ ?? []).map((q: Record<string, unknown>) => q.title));
      const nuevos = narrative.prevention_plan
        .filter((p) => !existing.has(p))
        .map((p, i) => ({
          parent_id: user.id,
          child_id,
          title: p,
          description: "Derivado del pronóstico: acción ligada a un umbral medido.",
          category: "prevention",
          points: 20 + i * 5,
          target_days: 3,
        }));
      if (nuevos.length > 0) await admin.from("quests").insert(nuevos);
    }

    return json({ prediction: saved, ...forecast, ...narrative });
  } catch (e) {
    console.error("predict-trends error:", e);
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});

// ── Capa de redacción ─────────────────────────────────────────────────────────

interface Narrative {
  explanation: string;
  drivers: string[];
  prevention_plan: string[];
}

/**
 * Traduce el pronóstico ya calculado. Nunca lanza: si la IA falla, se redacta
 * a partir de las cifras del motor. El pronóstico no se pierde ni se inventa.
 */
async function writeNarrative(
  apiKey: string | undefined,
  child: { name: string; age: number },
  f: ForecastResult,
): Promise<Narrative> {
  const h7 = f.horizons.find((h) => h.days === 7) ?? f.horizons[0];

  const fallback = (): Narrative => {
    const dir = f.trend === "worsening" ? "al alza"
      : f.trend === "improving" ? "a la baja" : "estable";
    return {
      explanation:
        `La tendencia de las últimas semanas es ${dir} (${f.slope_per_day} puntos por día). `
        + `A 7 días la proyección se sitúa entre ${h7.low_score} y ${h7.high_score}, `
        + `con un valor esperado de ${h7.expected_score}. Confianza del ${f.confidence}%.`
        + (f.counterfactual
          ? ` ${f.counterfactual.change}, la puntuación de hoy bajaría de `
            + `${f.counterfactual.score_now} a ${f.counterfactual.score_if_applied}.`
          : ""),
      drivers: f.early_warnings.slice(0, 3).map((w) => `${w.signal}: ${w.current}`),
      prevention_plan: f.early_warnings
        .filter((w) => w.margin.trim().startsWith("-") || parseFloat(w.margin) < 15)
        .slice(0, 3)
        .map((w) => `Vigilar ${w.signal.toLowerCase()} (ahora ${w.current}, umbral ${w.threshold.split("—")[0].trim()})`),
    };
  };

  if (!apiKey) return fallback();

  const horizonsText = f.horizons
    .map((h) => `- ${h.days} días: esperado ${h.expected_score} (rango ${h.low_score}–${h.high_score}), riesgo ${h.risk_level}`)
    .join("\n");
  const warningsText = f.early_warnings
    .map((w) => `- ${w.signal}: ahora ${w.current}, umbral ${w.threshold}, margen ${w.margin}`)
    .join("\n");

  const sys = `Traduces un pronóstico YA CALCULADO por un motor determinista a lenguaje claro para un padre o madre.

IMPORTANTE: las cifras, los rangos y la tendencia vienen dados. NO los recalcules, no los redondees a otros valores, no los contradigas ni añadas predicciones propias.

Reglas:
- Nunca diagnostiques. Habla de tendencias y señales, jamás de trastornos.
- Deja claro que es una proyección estadística sobre su patrón reciente, no una certeza.
- Si la confianza es baja o el rango es amplio, dilo con naturalidad.
- El plan de prevención debe salir de los umbrales dados, con cifras concretas y observables.
- Español cercano, sin jerga, sin alarmismo.`;

  const usr = `Niño/a: ${child.name}, ${child.age} años.

PRONÓSTICO CALCULADO (no lo modifiques):
Tendencia: ${f.trend} (${f.slope_per_day} puntos por día)
Nivel actual: ${f.current_level}
Confianza: ${f.confidence}%
Método: ${f.method}
Observaciones: ${f.trace.observations} días, ${f.trace.anomalous_days} atípicos

HORIZONTES:
${horizonsText}

SEÑALES A VIGILAR (umbrales reales del motor clínico):
${warningsText}
${f.counterfactual ? `\nESCENARIO CALCULADO: ${f.counterfactual.change}, la puntuación de hoy pasaría de ${f.counterfactual.score_now} a ${f.counterfactual.score_if_applied} (mejora de ${f.counterfactual.improvement} puntos).` : ""}

Redacta la explicación, los 3 factores principales y hasta 3 acciones de prevención medibles.`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        tools: [{
          type: "function",
          function: {
            name: "emit_forecast_narrative",
            parameters: {
              type: "object",
              properties: {
                explanation: { type: "string" },
                drivers: { type: "array", maxItems: 3, items: { type: "string" } },
                prevention_plan: { type: "array", maxItems: 3, items: { type: "string" } },
              },
              required: ["explanation", "drivers", "prevention_plan"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_forecast_narrative" } },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return fallback();

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);

    return {
      explanation: parsed.explanation || fallback().explanation,
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      prevention_plan: Array.isArray(parsed.prevention_plan) ? parsed.prevention_plan : [],
    };
  } catch {
    clearTimeout(timeout);
    return fallback();
  }
}
