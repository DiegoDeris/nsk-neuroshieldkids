// Coach IA semanal: genera un plan de prevención personalizado con KPIs medibles,
// micro-hábitos por día, criterio de éxito y guion de conversación. Persiste como quests.
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

    const [{ data: metrics }, { data: scores }, { data: lastPred }] = await Promise.all([
      admin.from("usage_metrics").select("*").eq("child_id", child_id).order("metric_date", { ascending: false }).limit(14),
      admin.from("emotional_scores").select("*").eq("child_id", child_id).order("created_at", { ascending: false }).limit(7),
      admin.from("predictions").select("*").eq("child_id", child_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const sys = `Eres coach de bienestar digital infantil para padres. NO diagnosticas. Diseña un plan SEMANAL ultra-concreto, basado en hábitos pequeños y medibles. Idioma: español, cercano y sin jerga. Cada acción debe ser observable y medible (ej: "móvil fuera del cuarto a las 22:00, 5/7 noches").`;
    const usr = `Perfil: ${child.name}, ${child.age} años.
Últimas métricas: ${JSON.stringify((metrics ?? []).slice(0,7).map((m:any)=>({d:m.metric_date,t:m.total_minutes,n:m.night_minutes,s:m.sessions,app:m.dominant_app})))}
Últimos scores: ${JSON.stringify((scores ?? []).map((s:any)=>({d:s.created_at,score:s.score,risk:s.risk_level})))}
Última predicción: ${JSON.stringify(lastPred ?? {})}
Diseña el plan semanal.`;

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        tools: [{ type: "function", function: {
          name: "emit_prevention_plan",
          parameters: {
            type: "object",
            properties: {
              focus_areas: { type: "array", maxItems: 3, items: { type: "string" } },
              kpis: {
                type: "array", maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    target: { type: "string", description: "Meta concreta (ej: <60min nocturno)" },
                    how_to_measure: { type: "string" },
                  },
                  required: ["name","target","how_to_measure"], additionalProperties: false,
                }
              },
              daily_micro_habits: {
                type: "array", maxItems: 7, minItems: 5,
                items: {
                  type: "object",
                  properties: {
                    day: { type: "string", enum: ["lun","mar","mie","jue","vie","sab","dom"] },
                    habit: { type: "string" },
                    why: { type: "string" },
                  },
                  required: ["day","habit","why"], additionalProperties: false,
                }
              },
              parent_conversation: { type: "array", maxItems: 3, items: { type: "string" } },
              success_criteria: { type: "string" },
              if_things_get_worse: { type: "string", description: "Plan B si la trayectoria empeora" },
            },
            required: ["focus_areas","kpis","daily_micro_habits","parent_conversation","success_criteria","if_things_get_worse"],
            additionalProperties: false,
          },
        }}],
        tool_choice: { type: "function", function: { name: "emit_prevention_plan" } },
      }),
    });

    if (res.status === 429) return new Response(JSON.stringify({ error: "Límite de peticiones" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (res.status === 402) return new Response(JSON.stringify({ error: "Cuota de IA agotada" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`AI ${res.status}`);

    const aiJson = await res.json();
    const args = JSON.parse(aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}");

    // Persistimos micro-hábitos como quests semanales
    if (Array.isArray(args.daily_micro_habits) && args.daily_micro_habits.length > 0) {
      // Deduplicar: no crear quests coach duplicados en la misma semana
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
      const { data: existingCoach } = await admin.from("quests")
        .select("title")
        .eq("child_id", child_id)
        .eq("category", "coach")
        .gte("created_at", weekAgo);
      const existingCoachTitles = new Set((existingCoach ?? []).map((q: any) => q.title));
      const newHabits = args.daily_micro_habits
        .map((h: any) => ({
          parent_id: user.id, child_id,
          title: `${h.day.toUpperCase()} · ${h.habit}`,
          description: h.why,
          category: "coach",
          points: 15,
          target_days: 1,
        }))
        .filter((q: any) => !existingCoachTitles.has(q.title));
      if (newHabits.length > 0) await admin.from("quests").insert(newHabits);
    }

    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("prevention-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
