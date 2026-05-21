// Análisis IA multidimensional del bienestar digital infantil.
// Devuelve dimensiones (sueño, ansiedad, ánimo, social, dependencia, atención),
// score global, severidad, evidencia, plan inmediato + largo plazo,
// guion de conversación y derivación profesional cuando proceda.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { child, metric, heuristic, history } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const lang = (child?.lang ?? "es").toString().startsWith("en") ? "en" : "es";

    const systemPrompt = lang === "en"
      ? `You are a senior digital wellbeing analyst for parents of minors. You are NOT a clinician and you DO NOT diagnose.
Strict rules:
- Use ONLY behavioral metadata (no message contents).
- Be evidence-based, empathetic, age-appropriate, concrete.
- All numeric scores 0-100 (higher = worse). Risk: low<40, medium 40-69, high>=70.
- "refer_to_professional" must be true ONLY if at least one of: night_minutes>90, total_minutes>360 sustained 3+ days, abrupt isolation pattern, severe sleep disruption, parent notes mention self-harm/suicide/severe distress.
- Conversation script: 3 short bullet sentences a parent can literally say, non-judgemental, curious tone.`
      : `Eres analista senior de bienestar digital infantil para padres. NO eres clínico y NO diagnosticas.
Reglas estrictas:
- Solo metadatos de uso (nunca contenido).
- Basado en evidencia, empático, adaptado a la edad, concreto.
- Todos los scores 0-100 (más alto = peor). Riesgo: low<40, medium 40-69, high>=70.
- "refer_to_professional" SOLO si: nocturno>90 min, total>360 min sostenido 3+ días, aislamiento abrupto, alteración severa del sueño, o las notas mencionan autolesión/suicidio/malestar severo.
- Guion de conversación: 3 frases cortas y literales que el padre/madre puede usar, sin juzgar, con curiosidad.`;

    const userPrompt = `Niño/a: ${child.name}, ${child.age} años.
Métricas hoy: total ${metric.total_minutes}min, nocturno ${metric.night_minutes}min, sesiones ${metric.sessions}, app dominante ${metric.dominant_app ?? "n/d"}.
Reparto: ${JSON.stringify(metric.app_breakdown ?? {})}
Notas del padre/madre: ${metric.notes ?? "ninguna"}
Heurística inicial: score ${heuristic.score} (${heuristic.risk_level}). Factores: ${heuristic.factors?.map((f:any)=>f.label).join("; ")||"ninguno"}.
Histórico últimos 14 días: ${JSON.stringify((history ?? []).slice(0,14))}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_emotional_analysis",
            description: "Emite el análisis multidimensional",
            parameters: {
              type: "object",
              properties: {
                emotional_score: { type: "integer", minimum: 0, maximum: 100 },
                risk_level: { type: "string", enum: ["low", "medium", "high"] },
                confidence: { type: "integer", minimum: 0, maximum: 100, description: "Confianza del modelo dadas las pruebas" },
                severity_tier: { type: "string", enum: ["preventive", "watch", "moderate", "critical"] },
                dimensions: {
                  type: "object",
                  description: "Cada dimensión 0-100, mayor = mayor riesgo en esa área",
                  properties: {
                    sleep_disruption: { type: "integer", minimum: 0, maximum: 100 },
                    anxiety_signals: { type: "integer", minimum: 0, maximum: 100 },
                    mood_volatility: { type: "integer", minimum: 0, maximum: 100 },
                    social_withdrawal: { type: "integer", minimum: 0, maximum: 100 },
                    dependency: { type: "integer", minimum: 0, maximum: 100 },
                    attention_fragmentation: { type: "integer", minimum: 0, maximum: 100 },
                  },
                  required: ["sleep_disruption","anxiety_signals","mood_volatility","social_withdrawal","dependency","attention_fragmentation"],
                  additionalProperties: false,
                },
                detected_patterns: { type: "array", maxItems: 4, items: { type: "string" } },
                evidence: {
                  type: "array", maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      claim: { type: "string" },
                      data_point: { type: "string", description: "Métrica concreta que respalda" },
                    },
                    required: ["claim","data_point"], additionalProperties: false,
                  }
                },
                explanation: { type: "string" },
                immediate_actions: { type: "array", maxItems: 3, items: { type: "string" }, description: "Para HOY mismo" },
                long_term_actions: { type: "array", maxItems: 3, items: { type: "string" }, description: "Para 2-4 semanas" },
                conversation_script: { type: "array", maxItems: 3, items: { type: "string" } },
                refer_to_professional: { type: "boolean" },
                referral_reason: { type: "string" },
              },
              required: ["emotional_score","risk_level","confidence","severity_tier","dimensions","detected_patterns","evidence","explanation","immediate_actions","long_term_actions","conversation_script","refer_to_professional","referral_reason"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_emotional_analysis" } },
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Límite de peticiones alcanzado. Inténtalo en unos segundos." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Cuota de IA agotada. Revisa tu límite en Google AI Studio." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`Gateway ${response.status}`);
    }

    const data = await response.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("Sin tool call en respuesta IA");
    const args = JSON.parse(call.function.arguments);

    // Mantenemos compatibilidad con clientes antiguos: actions = immediate + long
    args.actions = [...(args.immediate_actions ?? []), ...(args.long_term_actions ?? [])];

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("analyze-emotional error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
