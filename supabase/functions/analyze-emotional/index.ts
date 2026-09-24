// analyze-emotional v3 — motor clínico determinista + IA como capa de redacción.
//
// Cambio de arquitectura respecto a v2:
//   ANTES: se enviaban cifras crudas a Gemini y el modelo puntuaba las seis
//          dimensiones. El resultado no era reproducible ni trazable.
//   AHORA: el motor determinista calcula puntuaciones, evidencia y dominios
//          clínicos. Gemini recibe ese resultado ya cerrado y su único trabajo
//          es explicárselo al padre y proponer acciones.
//
// Consecuencia: mismos datos → mismas puntuaciones, siempre. Y cada alerta
// puede justificarse señalando la métrica y el umbral que la dispararon.
import { createClient } from "npm:@supabase/supabase-js@2";
import { runClinicalEngine, ENGINE_VERSION } from "../_shared/clinicalEngine.ts";
import type { DayMetric } from "../_shared/clinicalEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function unauthorized(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth: verificar JWT y plan premium ──────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return unauthorized("no autorizado");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return unauthorized("sesión inválida");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sub } = await admin.from("subscriptions").select("plan,status").eq("user_id", user.id).maybeSingle();
    if (!sub || !["active", "past_due"].includes(sub.status) || sub.plan !== "premium") {
      return new Response(JSON.stringify({ error: "Esta función requiere plan Premium." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { child, metric, history } = await req.json();
    const lang = (child?.lang ?? "es").toString().startsWith("en") ? "en" : "es";

    // ── PASO 1: el motor determinista decide ────────────────────────────────
    const today: DayMetric = {
      metric_date: metric.metric_date,
      total_minutes: Number(metric.total_minutes ?? 0),
      night_minutes: Number(metric.night_minutes ?? 0),
      sessions: Number(metric.sessions ?? 0),
      dominant_app: metric.dominant_app ?? null,
      app_breakdown: metric.app_breakdown ?? null,
      behavioral_signals: metric.behavioral_signals ?? null,
    };

    const past: DayMetric[] = (history ?? []).map((h: Record<string, unknown>) => ({
      metric_date: (h.metric_date ?? h.d) as string | undefined,
      total_minutes: Number(h.total_minutes ?? h.t ?? 0),
      night_minutes: Number(h.night_minutes ?? h.n ?? 0),
      sessions: Number(h.sessions ?? h.s ?? 0),
      app_breakdown: (h.app_breakdown ?? null) as Record<string, number> | null,
      behavioral_signals: (h.behavioral_signals ?? null) as DayMetric["behavioral_signals"],
    }));

    const engine = runClinicalEngine({
      age: Number(child?.age ?? 12),
      today,
      history: past,
    });

    // ── PUERTA DE SEGURIDAD ─────────────────────────────────────────────────
    // Si la fuente no mide el dispositivo de verdad, se devuelve el estado de
    // "no evaluable" y se corta aquí. No se llama a la IA, no se inventa una
    // explicación y no se muestra ninguna puntuación. Un padre debe saber que
    // no sabemos, en lugar de recibir un número sin respaldo.
    if (!engine.assessable) {
      return new Response(JSON.stringify({
        ...engine,
        engine_version: ENGINE_VERSION,
        explanation: engine.not_assessable_reason ?? "No hay datos suficientes para evaluar.",
        detected_patterns: [],
        immediate_actions: [],
        long_term_actions: [],
        conversation_script: [],
        actions: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── PASO 2: la IA solo traduce el resultado ─────────────────────────────
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const systemPrompt = lang === "en"
      ? `You translate a completed behavioural analysis into plain language for a parent.

CRITICAL: the scores, risk level and evidence have ALREADY been computed by a deterministic engine. Do NOT re-score, contradict or second-guess them. Your job is only to explain and advise.

Rules:
- Never diagnose. Speak of signals and patterns, never of disorders.
- Refer only to the evidence provided. Invent nothing.
- Warm, concrete, non-alarmist. Address the parent directly.
- Conversation script: 3 short sentences the parent can literally say, curious and non-judgemental.
- If confidence is low, say so plainly.`
      : `Traduces un análisis conductual ya realizado a lenguaje claro para un padre o madre.

IMPORTANTE: las puntuaciones, el nivel de riesgo y la evidencia YA los ha calculado un motor determinista. NO los recalcules, ni los contradigas, ni los cuestiones. Tu único trabajo es explicar y aconsejar.

Reglas:
- Nunca diagnostiques. Habla de señales y patrones, jamás de trastornos.
- Apóyate solo en la evidencia proporcionada. No inventes nada.
- Tono cercano, concreto y sin alarmismo. Dirígete al padre o madre de tú.
- Guion de conversación: 3 frases cortas y literales que pueda decirle a su hijo, con curiosidad y sin juzgar.
- Si la confianza es baja, dilo con naturalidad.`;

    const dimLabels: Record<string, string> = {
      sleep_disruption: "alteración del sueño",
      anxiety_signals: "señales de ansiedad",
      mood_volatility: "volatilidad del ánimo",
      social_withdrawal: "aislamiento social",
      dependency: "dependencia",
      attention_fragmentation: "fragmentación de la atención",
    };

    const dimsText = Object.entries(engine.dimensions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${dimLabels[k] ?? k}: ${v}/100${engine.unavailable_dimensions.includes(k as never) ? " (sin datos suficientes)" : ""}`)
      .join("\n");

    const evidenceText = engine.evidence
      .map((e) => `- ${e.claim} → ${e.data_point}`)
      .join("\n");

    const domainsText = engine.clinical_domains
      .map((d) => `- ${d.domain} (${d.instrument}): ${d.met ? "INDICIOS PRESENTES" : "sin indicios"} — ${d.rationale}`)
      .join("\n");

    const userPrompt = `Niño/a: ${child.name}, ${child.age} años.

RESULTADO DEL MOTOR (ya calculado, no lo modifiques):
Puntuación global: ${engine.emotional_score}/100 — riesgo ${engine.risk_level} — nivel ${engine.severity_tier}
Confianza: ${engine.confidence}% (${engine.trace.data_days} días de historial, señales nativas: ${engine.trace.has_native_signals ? "sí" : "no"})

DIMENSIONES:
${dimsText}

EVIDENCIA MEDIDA:
${evidenceText || "- Sin señales destacables hoy"}

DOMINIOS CLÍNICOS EVALUADOS:
${domainsText}
${engine.change_point ? `\nPUNTO DE CAMBIO: ${engine.change_point.direction === "increase" ? "aumento" : "descenso"} del ${engine.change_point.magnitude_pct}% en ${engine.change_point.metric} desde ${engine.change_point.date}` : ""}
${engine.refer_to_professional ? `\nDERIVACIÓN RECOMENDADA: ${engine.referral_reason}` : ""}

Notas del padre/madre: ${metric.notes ?? "ninguna"}

Redacta la explicación, las acciones y el guion de conversación.`;

    const AI_TIMEOUT_MS = 45_000;
    let response: Response | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      try {
        response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${GEMINI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-2.0-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "emit_narrative",
                description: "Redacta la explicación y las recomendaciones para el padre",
                parameters: {
                  type: "object",
                  properties: {
                    explanation: {
                      type: "string",
                      description: "2-4 frases explicando qué se ha observado y por qué importa",
                    },
                    detected_patterns: {
                      type: "array", maxItems: 4, items: { type: "string" },
                      description: "Patrones en lenguaje llano, uno por línea",
                    },
                    immediate_actions: {
                      type: "array", maxItems: 3, items: { type: "string" },
                      description: "Acciones para hoy mismo",
                    },
                    long_term_actions: {
                      type: "array", maxItems: 3, items: { type: "string" },
                      description: "Acciones para las próximas 2-4 semanas",
                    },
                    conversation_script: {
                      type: "array", maxItems: 3, items: { type: "string" },
                      description: "Frases literales para hablar con el hijo",
                    },
                  },
                  required: ["explanation", "detected_patterns", "immediate_actions", "long_term_actions", "conversation_script"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "emit_narrative" } },
          }),
        });
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        if ((fetchErr as { name?: string })?.name === "AbortError") {
          throw new Error("El análisis IA tardó demasiado (timeout). Inténtalo de nuevo.");
        }
        throw fetchErr;
      }
      clearTimeout(timeoutId);
      if (response.status !== 429) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }

    // Si la IA falla, el análisis NO se pierde: el motor ya ha decidido y
    // devolvemos el resultado con una redacción de reserva. Esto es una ventaja
    // directa de separar el cálculo de la redacción.
    let narrative = {
      explanation: "",
      detected_patterns: [] as string[],
      immediate_actions: [] as string[],
      long_term_actions: [] as string[],
      conversation_script: [] as string[],
    };

    if (response && response.ok) {
      const data = await response.json();
      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      if (call) narrative = { ...narrative, ...JSON.parse(call.function.arguments) };
    }

    if (!narrative.explanation) {
      narrative.explanation = buildFallbackExplanation(engine, child?.name ?? "tu hijo");
      narrative.detected_patterns = engine.evidence.slice(0, 3).map((e) => e.claim);
    }

    // ── Respuesta: motor + redacción ────────────────────────────────────────
    const result = {
      // Decidido por el motor determinista
      emotional_score: engine.emotional_score,
      risk_level: engine.risk_level,
      severity_tier: engine.severity_tier,
      confidence: engine.confidence,
      dimensions: engine.dimensions,
      unavailable_dimensions: engine.unavailable_dimensions,
      evidence: engine.evidence.map((e) => ({ claim: e.claim, data_point: e.data_point })),
      clinical_domains: engine.clinical_domains,
      change_point: engine.change_point,
      refer_to_professional: engine.refer_to_professional,
      referral_reason: engine.referral_reason,
      trace: engine.trace,
      engine_version: ENGINE_VERSION,

      // Redactado por el modelo
      explanation: narrative.explanation,
      detected_patterns: narrative.detected_patterns,
      immediate_actions: narrative.immediate_actions,
      long_term_actions: narrative.long_term_actions,
      conversation_script: narrative.conversation_script,

      // Compatibilidad con clientes anteriores
      actions: [...narrative.immediate_actions, ...narrative.long_term_actions],
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-emotional error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** Redacción de reserva si la IA no responde. El análisis nunca se pierde. */
function buildFallbackExplanation(
  engine: ReturnType<typeof runClinicalEngine>,
  name: string,
): string {
  const top = engine.evidence[0];
  const level = engine.risk_level === "high" ? "alto" : engine.risk_level === "medium" ? "moderado" : "bajo";
  if (!top) {
    return `Hoy no se han detectado señales destacables en el uso de ${name}. Nivel de riesgo ${level}.`;
  }
  return `Se ha detectado principalmente: ${top.claim.toLowerCase()} (${top.data_point}). ` +
    `El nivel de riesgo global es ${level}, con una confianza del ${engine.confidence}%.`;
}
