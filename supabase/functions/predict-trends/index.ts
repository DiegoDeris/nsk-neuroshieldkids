// Predicción IA multi-horizonte (3, 7 y 30 días) con escenarios "con/sin intervención",
// indicadores tempranos y plan de prevención accionable. Crea quests automáticas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { child_id } = await req.json();
    if (!child_id) throw new Error("child_id requerido");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: child } = await admin.from("children").select("*").eq("id", child_id).maybeSingle();
    if (!child || child.parent_id !== user.id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: metrics } = await admin.from("usage_metrics").select("*").eq("child_id", child_id).order("metric_date", { ascending: false }).limit(30);
    const { data: scores } = await admin.from("emotional_scores").select("score,risk_level,patterns,created_at").eq("child_id", child_id).order("created_at", { ascending: false }).limit(30);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const sys = `Eres analista senior de bienestar digital infantil. NO diagnosticas. Predices trayectorias usando los datos de uso digital y los scores históricos. Español, claro, accionable, basado en evidencia. Devuelve siempre intervalos de confianza (lo + bajo, esperado, lo + alto) y dos escenarios: con plan de prevención aplicado y sin intervención.`;
    const usr = `Niño/a: ${child.name}, ${child.age} años.
Métricas (más reciente primero, max 30): ${JSON.stringify((metrics ?? []).map((m: any) => ({ d: m.metric_date, t: m.total_minutes, n: m.night_minutes, s: m.sessions, app: m.dominant_app })))}
Scores recientes (max 30): ${JSON.stringify(scores ?? [])}
Predice horizontes 3, 7 y 30 días. Identifica 3 indicadores tempranos a vigilar y 3 acciones de prevención inmediatas.`;

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        tools: [{ type: "function", function: {
          name: "emit_prediction",
          description: "Devuelve la predicción multi-horizonte con escenarios e indicadores tempranos.",
          parameters: {
            type: "object",
            properties: {
              horizons: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    days: { type: "integer", description: "3, 7 o 30" },
                    expected_score: { type: "integer", description: "0-100" },
                    low_score: { type: "integer", description: "0-100" },
                    high_score: { type: "integer", description: "0-100" },
                    risk_level: { type: "string", enum: ["low","medium","high"] },
                    trend: { type: "string", enum: ["improving","stable","worsening"] },
                  },
                  required: ["days","expected_score","low_score","high_score","risk_level","trend"],
                }
              },
              scenario_with_intervention: {
                type: "object",
                properties: {
                  expected_score_7d: { type: "integer", description: "0-100" },
                  delta_vs_baseline: { type: "integer", description: "Mejora esperada (puede ser negativa)" },
                  rationale: { type: "string" },
                },
                required: ["expected_score_7d","delta_vs_baseline","rationale"],
              },
              scenario_no_intervention: {
                type: "object",
                properties: {
                  expected_score_7d: { type: "integer", description: "0-100" },
                  rationale: { type: "string" },
                },
                required: ["expected_score_7d","rationale"],
              },
              early_warning_signals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    signal: { type: "string" },
                    threshold: { type: "string", description: "Cuándo saltaría la alarma (ej: nocturno>45min 2 días)" },
                  },
                  required: ["signal","threshold"],
                }
              },
              drivers: { type: "array", items: { type: "string" } },
              prevention_plan: { type: "array", items: { type: "string" } },
              confidence: { type: "integer", description: "0-100" },
              data_quality: { type: "string", enum: ["low","medium","high"] },
              explanation: { type: "string" },
            },
            required: ["horizons","scenario_with_intervention","scenario_no_intervention","early_warning_signals","drivers","prevention_plan","confidence","data_quality","explanation"],
          },
        }}],
        tool_choice: { type: "function", function: { name: "emit_prediction" } },
      }),
    });

    if (res.status === 429) return new Response(JSON.stringify({ error: "Límite de peticiones" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (res.status === 402) return new Response(JSON.stringify({ error: "Cuota de IA agotada" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      console.error("AI gateway error", res.status, body);
      throw new Error(`AI ${res.status}: ${body.slice(0, 300)}`);
    }

    const aiJson = await res.json();
    const args = JSON.parse(aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}");

    const h7 = (args.horizons ?? []).find((h: any) => h.days === 7) ?? args.horizons?.[0] ?? { expected_score: 50, risk_level: "medium", trend: "stable" };

    // Persistimos compatible con esquema existente; metadatos extra van en drivers/prevention_plan ya como jsonb arrays + extras dentro de "drivers"
    const { data: saved } = await admin.from("predictions").insert([{
      parent_id: user.id, child_id,
      predicted_score: h7.expected_score,
      predicted_risk: h7.risk_level,
      trend: h7.trend,
      drivers: args.drivers,
      prevention_plan: args.prevention_plan,
      confidence: args.confidence,
      explanation: args.explanation,
    }]).select().single();

    if (Array.isArray(args.prevention_plan) && args.prevention_plan.length > 0) {
      // Deduplicar: evitar quests duplicados si se llama varias veces
      const { data: existingQ } = await admin.from("quests")
        .select("title")
        .eq("child_id", child_id)
        .eq("category", "prevention")
        .eq("status", "active");
      const existingTitles = new Set((existingQ ?? []).map((q: any) => q.title));
      const newQuests = args.prevention_plan
        .filter((p: string) => !existingTitles.has(p))
        .map((p: string, i: number) => ({
          parent_id: user.id, child_id,
          title: p,
          description: "Reto sugerido por la IA basado en la predicción multi-horizonte.",
          category: "prevention",
          points: 20 + i * 5,
          target_days: 3,
        }));
      if (newQuests.length > 0) await admin.from("quests").insert(newQuests);
    }

    return new Response(JSON.stringify({ prediction: saved, ...args }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("predict-trends error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
