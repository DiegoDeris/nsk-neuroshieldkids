// prevention-coach v2 — plan semanal anclado a mediciones reales.
//
// QUÉ CAMBIA RESPECTO A v1
//
// v1 le pasaba métricas crudas a Gemini y le pedía un plan con KPIs numéricos.
// El modelo inventaba las metas ("menos de 60 min nocturno") sin saber cuál era
// la línea base de ESE niño ni los umbrales que usa el motor clínico. Además
// funcionaba igual con datos que no miden nada: producía un plan semanal de
// aspecto profesional sobre un dispositivo del que no se sabía nada.
//
// v2:
//   - Puerta de calidad: sin medición real del dispositivo, no hay plan.
//   - Las metas se CALCULAN a partir de la línea base del propio niño y de los
//     umbrales del motor clínico. El modelo las redacta, no las elige.
//   - Un plan de hábitos sí es una tarea de lenguaje, y ahí el modelo aporta.
//     Pero las cifras vienen dadas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { runClinicalEngine, ENGINE_VERSION } from "../_shared/clinicalEngine.ts";
import type { DayMetric } from "../_shared/clinicalEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Horas de sueño recomendadas (American Academy of Sleep Medicine). */
function recommendedSleepHours(age: number): number {
  if (age <= 5) return 11;
  if (age <= 12) return 10;
  if (age <= 17) return 9;
  return 8;
}

interface Objetivo {
  name: string;
  /** Meta calculada, no elegida por el modelo. */
  target: string;
  current: string;
  how_to_measure: string;
  /** De dónde sale la cifra. */
  basis: string;
}

/**
 * Metas calculadas a partir de lo que este niño hace de verdad.
 *
 * El criterio es acercarse a su propia línea base, no a un ideal abstracto:
 * un objetivo alcanzable y medible vale más que uno ambicioso e inventado.
 */
function construirObjetivos(
  today: DayMetric,
  history: DayMetric[],
  age: number,
): Objetivo[] {
  const sig = today.behavioral_signals ?? {};
  const out: Objetivo[] = [];

  // ── Uso nocturno ───────────────────────────────────────────────────────────
  const nightNow = sig.night_minutes ?? today.night_minutes ?? 0;
  const nightBase = median(history.map((h) => h.night_minutes ?? 0));
  if (nightNow > 10) {
    // Meta: volver a su media habitual, o bajar a la mitad si su media ya es alta.
    const meta = nightBase < nightNow
      ? Math.max(0, Math.round(nightBase))
      : Math.round(nightNow / 2);
    out.push({
      name: "Uso nocturno (23:00–06:00)",
      target: `${meta} min o menos`,
      current: `${nightNow} min`,
      how_to_measure: "La app lo mide sola cada noche; aparece en el detalle del hijo",
      basis: nightBase < nightNow
        ? `Su propia media de las últimas semanas (${Math.round(nightBase)} min)`
        : "La mitad de su uso nocturno actual",
    });
  }

  // ── Desbloqueos ────────────────────────────────────────────────────────────
  if (typeof sig.unlocks === "number") {
    const baseUnlocks = median(
      history.map((h) => h.behavioral_signals?.unlocks).filter((v): v is number => typeof v === "number"),
    );
    // 50/día es el umbral de comprobación compulsiva que usa el motor clínico.
    const meta = sig.unlocks > 50
      ? Math.max(40, Math.round(baseUnlocks || sig.unlocks * 0.7))
      : Math.round(sig.unlocks * 0.85);
    out.push({
      name: "Veces que coge el móvil al día",
      target: `${meta} o menos`,
      current: `${sig.unlocks}`,
      how_to_measure: "Desbloqueos contados por la app",
      basis: sig.unlocks > 50
        ? "Por encima de 50 al día se considera comprobación compulsiva"
        : "Reducción del 15% sobre su patrón actual",
    });
  }

  // ── Descanso ───────────────────────────────────────────────────────────────
  const sleepMin = sig.sleep_minutes ?? sig.longest_idle_gap_minutes ?? 0;
  if (sleepMin > 0) {
    const needH = recommendedSleepHours(age);
    const nowH = sleepMin / 60;
    if (nowH < needH) {
      // Meta intermedia: la mitad del camino. Pedir 3 horas más de golpe no se
      // cumple; media hora más sí.
      const meta = Math.min(needH, Math.round((nowH + (needH - nowH) / 2) * 10) / 10);
      out.push({
        name: "Horas de descanso",
        target: `${meta} h`,
        current: `${nowH.toFixed(1)} h`,
        how_to_measure: "Ventana sin actividad en el dispositivo durante la noche",
        basis: `Paso intermedio hacia las ${needH} h recomendadas para ${age} años`,
      });
    }
  }

  // ── Tiempo total ───────────────────────────────────────────────────────────
  const baseTotal = median(history.map((h) => h.total_minutes ?? 0));
  if (baseTotal > 0 && today.total_minutes > baseTotal * 1.2) {
    out.push({
      name: "Tiempo de pantalla diario",
      target: `${Math.round(baseTotal)} min`,
      current: `${today.total_minutes} min`,
      how_to_measure: "Suma diaria de uso de aplicaciones",
      basis: `Su media de las últimas semanas (${Math.round(baseTotal)} min)`,
    });
  }

  return out.slice(0, 4);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { child_id } = await req.json();
    if (!child_id) throw new Error("child_id requerido");

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

    const { data: metricsRaw } = await admin.from("usage_metrics")
      .select("*").eq("child_id", child_id)
      .order("metric_date", { ascending: false }).limit(21);

    const metrics = (metricsRaw ?? []) as Array<Record<string, unknown>>;
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
    const history = metrics.slice(1).map(toDayMetric);
    const age = Number(child.age);

    // ── PUERTA DE CALIDAD ────────────────────────────────────────────────────
    // Sin medición real no hay plan. Un plan semanal con metas numéricas sobre
    // datos que no miden nada es exactamente el tipo de cosa que no debe salir
    // de un producto de salud mental infantil.
    const engine = today
      ? runClinicalEngine({ age, today, history })
      : null;

    if (!engine || !engine.assessable) {
      return json({
        plannable: false,
        not_plannable_reason: engine?.not_assessable_reason
          ?? "Todavía no hay datos medidos del dispositivo. Un plan con metas "
            + "numéricas sobre datos que no miden nada no te serviría de nada.",
        engine_version: ENGINE_VERSION,
        kpis: [],
        daily_micro_habits: [],
      });
    }

    // ── Objetivos calculados ─────────────────────────────────────────────────
    const objetivos = construirObjetivos(today!, history, age);

    if (objetivos.length === 0) {
      return json({
        plannable: true,
        kpis: [],
        daily_micro_habits: [],
        focus_areas: [],
        success_criteria: "No hay ningún indicador fuera de su patrón habitual. "
          + "No hace falta plan de corrección: lo que está haciendo funciona.",
        if_things_get_worse: "Si alguna señal empieza a subir, el análisis diario te avisará.",
        parent_conversation: [],
        engine_version: ENGINE_VERSION,
      });
    }

    // ── El modelo redacta los hábitos; las cifras vienen dadas ───────────────
    const plan = await writePlan(
      Deno.env.get("GEMINI_API_KEY"),
      { name: String(child.name), age },
      objetivos,
      engine.evidence.slice(0, 3).map((e) => `${e.claim} (${e.data_point})`),
    );

    // ── Persistencia como retos ──────────────────────────────────────────────
    if (plan.daily_micro_habits.length > 0) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
      const { data: existingCoach } = await admin.from("quests")
        .select("title").eq("child_id", child_id)
        .eq("category", "coach").gte("created_at", weekAgo);
      const existing = new Set((existingCoach ?? []).map((q: Record<string, unknown>) => q.title));

      const nuevos = plan.daily_micro_habits
        .map((h) => ({
          parent_id: user.id,
          child_id,
          title: `${h.day.toUpperCase()} · ${h.habit}`,
          description: h.why,
          category: "coach",
          points: 15,
          target_days: 1,
        }))
        .filter((q) => !existing.has(q.title));

      if (nuevos.length > 0) await admin.from("quests").insert(nuevos);
    }

    return json({
      plannable: true,
      // Los KPIs son los objetivos calculados, no los que invente el modelo.
      kpis: objetivos,
      engine_version: ENGINE_VERSION,
      ...plan,
    });
  } catch (e) {
    console.error("prevention-coach error:", e);
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});

// ── Capa de redacción ─────────────────────────────────────────────────────────

interface MicroHabit {
  day: string;
  habit: string;
  why: string;
}

interface Plan {
  focus_areas: string[];
  daily_micro_habits: MicroHabit[];
  parent_conversation: string[];
  success_criteria: string;
  if_things_get_worse: string;
}

/** Nunca lanza: si la IA falla, el plan se construye desde los objetivos. */
async function writePlan(
  apiKey: string | undefined,
  child: { name: string; age: number },
  objetivos: Objetivo[],
  evidencia: string[],
): Promise<Plan> {
  const dias = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

  const fallback = (): Plan => ({
    focus_areas: objetivos.map((o) => o.name),
    daily_micro_habits: dias.slice(0, 5).map((day, i) => {
      const o = objetivos[i % objetivos.length];
      return {
        day,
        habit: `Revisar ${o.name.toLowerCase()}: objetivo ${o.target}`,
        why: o.basis,
      };
    }),
    parent_conversation: [],
    success_criteria: objetivos
      .map((o) => `${o.name}: pasar de ${o.current} a ${o.target}`)
      .join(". "),
    if_things_get_worse:
      "Si tras dos semanas los indicadores no bajan, conviene comentarlo con el "
      + "pediatra o un psicólogo infantil.",
  });

  if (!apiKey) return fallback();

  const objetivosText = objetivos
    .map((o) => `- ${o.name}: ahora ${o.current} → meta ${o.target}. Base del cálculo: ${o.basis}`)
    .join("\n");

  const sys = `Eres coach de bienestar digital infantil para padres. NO diagnosticas.

IMPORTANTE: las metas numéricas vienen YA CALCULADAS a partir de las mediciones reales de este niño. NO inventes otras cifras, no las cambies ni añadas objetivos numéricos propios. Tu trabajo es convertir esas metas en hábitos diarios concretos y observables.

Reglas:
- Cada hábito debe ser una acción física y verificable, no un propósito vago.
  Bien: "móvil a cargar en la cocina a las 21:30". Mal: "reducir el uso nocturno".
- Hábitos pequeños: se cumplen. Grandes: se abandonan.
- Español cercano, sin jerga, sin culpabilizar al padre ni al niño.
- El guion de conversación son frases literales que el padre puede decir, con
  curiosidad y sin reproche.`;

  const usr = `Niño/a: ${child.name}, ${child.age} años.

OBJETIVOS CALCULADOS (no los modifiques):
${objetivosText}

LO QUE SE HA MEDIDO:
${evidencia.join("\n") || "- Sin señales destacables"}

Diseña entre 5 y 7 micro-hábitos diarios que lleven a esos objetivos.`;

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
            name: "emit_prevention_plan",
            parameters: {
              type: "object",
              properties: {
                focus_areas: { type: "array", maxItems: 3, items: { type: "string" } },
                daily_micro_habits: {
                  type: "array", maxItems: 7, minItems: 5,
                  items: {
                    type: "object",
                    properties: {
                      day: { type: "string", enum: dias },
                      habit: { type: "string" },
                      why: { type: "string" },
                    },
                    required: ["day", "habit", "why"],
                    additionalProperties: false,
                  },
                },
                parent_conversation: { type: "array", maxItems: 3, items: { type: "string" } },
                success_criteria: { type: "string" },
                if_things_get_worse: { type: "string" },
              },
              required: ["focus_areas", "daily_micro_habits", "parent_conversation", "success_criteria", "if_things_get_worse"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_prevention_plan" } },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return fallback();

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) return fallback();
    const p = JSON.parse(raw);

    return {
      focus_areas: Array.isArray(p.focus_areas) ? p.focus_areas : fallback().focus_areas,
      daily_micro_habits: Array.isArray(p.daily_micro_habits) && p.daily_micro_habits.length
        ? p.daily_micro_habits
        : fallback().daily_micro_habits,
      parent_conversation: Array.isArray(p.parent_conversation) ? p.parent_conversation : [],
      success_criteria: p.success_criteria || fallback().success_criteria,
      if_things_get_worse: p.if_things_get_worse || fallback().if_things_get_worse,
    };
  } catch {
    clearTimeout(timeout);
    return fallback();
  }
}
