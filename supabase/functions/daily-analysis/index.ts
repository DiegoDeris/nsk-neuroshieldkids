// Cron diario 08:00 — agrega eventos del día anterior y dispara IA + alertas para todos los hijos con datos.
// v2: pasa historial de 14 días a la IA, usa heurística mejorada con momentum, evita alertas duplicadas.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Heurística alineada con scoring.ts v2 — incluye comparación semana previa y momentum. */
function computeHeuristic(
  m: { total_minutes: number; night_minutes: number; sessions: number; dominant_app?: string | null; app_breakdown?: Record<string, number> | null },
  history: { total_minutes: number; night_minutes: number; sessions: number }[] = []
) {
  let score = 0;
  const factors: { label: string }[] = [];

  // 1. Tiempo total
  if (m.total_minutes > 120) {
    const v = Math.min(35, Math.round((m.total_minutes - 120) / 10));
    score += v;
    factors.push({ label: "Exceso de tiempo diario" });
  }

  // 2. Uso nocturno
  if (m.night_minutes > 30) {
    const v = Math.min(25, Math.round((m.night_minutes - 30) / 4));
    score += v;
    factors.push({ label: "Uso nocturno elevado" });
  }

  // 3. Comparación semana previa (alineado con scoring.ts)
  const prevWeekItems = history.slice(0, 7);
  if (prevWeekItems.length > 0) {
    const prevAvg = prevWeekItems.reduce((a, h) => a + h.total_minutes, 0) / prevWeekItems.length;
    if (prevAvg > 0) {
      const delta = (m.total_minutes - prevAvg) / prevAvg;
      if (delta > 0.3) {
        const v = Math.min(20, Math.round(delta * 30));
        score += v;
        factors.push({ label: `Aumento ${Math.round(delta * 100)}% vs semana previa` });
      }
    }
  }

  // 4. Sesiones
  if (m.sessions > 30) {
    const v = Math.min(15, m.sessions - 30);
    score += v;
    factors.push({ label: "Muchas sesiones cortas" });
  }

  // 5. App dominante de alto enganche
  const da = (m.dominant_app ?? "").toLowerCase();
  if (["tiktok", "instagram", "snapchat", "youtube"].some(x => da.includes(x))) {
    score += 10;
    factors.push({ label: "App dominante de alto enganche" });
  }

  // 6. Momentum: 3+ días consecutivos con score alto
  if (history.length >= 3) {
    const recent3 = history.slice(0, 3);
    const allHigh = recent3.every(h => {
      let s = 0;
      if (h.total_minutes > 120) s += Math.min(35, Math.round((h.total_minutes - 120) / 10));
      if (h.night_minutes > 30) s += Math.min(25, Math.round((h.night_minutes - 30) / 4));
      return s >= 40;
    });
    if (allHigh) {
      score += 15;
      factors.push({ label: "Patrón persistente (3+ días)" });
    }
  }

  score = Math.min(100, score);
  const risk_level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, risk_level, factors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verificar CRON_SECRET para prevenir invocaciones no autorizadas
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (provided !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
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

        // Historial de los últimos 14 días (para heurística y contexto IA)
        const { data: histMetrics } = await admin.from("usage_metrics")
          .select("total_minutes, night_minutes, sessions, metric_date")
          .eq("child_id", cid)
          .lt("metric_date", day)
          .order("metric_date", { ascending: false })
          .limit(14);
        const history = histMetrics ?? [];

        const heuristic = computeHeuristic(metric, history);

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

        // Llamada IA con historial
        const historyCompact = history.slice(0, 14).map((m: any) => ({
          d: m.metric_date, t: m.total_minutes, n: m.night_minutes, s: m.sessions
        }));

        const aiCtrl = new AbortController();
        const aiTimeout = setTimeout(() => aiCtrl.abort(), 60_000);
        let aiRes: Response;
        try {
        aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          signal: aiCtrl.signal,
          headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-2.0-flash",
            messages: [
              { role: "system", content: "Eres asistente de bienestar digital infantil para padres. NO diagnosticas. Español, empático, preventivo, basado en evidencia." },
              { role: "user", content: `Niño/a: ${child.name}, ${child.age} años.\nMétricas ${day}: total ${metric.total_minutes}min, nocturno ${metric.night_minutes}min, sesiones ${metric.sessions}, app dominante ${metric.dominant_app ?? "n/d"}, reparto ${JSON.stringify(metric.app_breakdown ?? {})}.\nHeurística: ${heuristic.score} (${heuristic.risk_level}). Factores: ${heuristic.factors.map((f: any) => f.label).join("; ") || "ninguno"}.\nHistórico 14 días: ${JSON.stringify(historyCompact)}` },
            ],
            tools: [{ type: "function", function: {
              name: "emit_emotional_analysis",
              parameters: {
                type: "object",
                properties: {
                  emotional_score: { type: "integer", minimum: 0, maximum: 100 },
                  risk_level: { type: "string", enum: ["low","medium","high"] },
                  detected_patterns: { type: "array", maxItems: 3, items: { type: "string" } },
                  explanation: { type: "string" },
                  actions: { type: "array", maxItems: 3, items: { type: "string" } },
                },
                required: ["emotional_score","risk_level","detected_patterns","explanation","actions"],
                additionalProperties: false,
              },
            }}],
            tool_choice: { type: "function", function: { name: "emit_emotional_analysis" } },
          }),
        });
        } catch (e: any) { clearTimeout(aiTimeout); if (e?.name === "AbortError") { console.warn("ai timeout for child", cid); continue; } throw e; }
        clearTimeout(aiTimeout);
        if (!aiRes.ok) { console.error("ai err", aiRes.status, await aiRes.text()); continue; }
        const aiJson = await aiRes.json();
        const args = JSON.parse(aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}");
        if (args.emotional_score === undefined || args.emotional_score === null) continue;

        await admin.from("emotional_scores").insert([{
          child_id: cid, parent_id: child.parent_id,
          score: args.emotional_score, risk_level: args.risk_level,
          patterns: args.detected_patterns, explanation: args.explanation, actions: args.actions,
          source_metric_id: metric.id,
        }]);

        if (Array.isArray(args.actions)) {
          await admin.from("recommendations").insert(args.actions.map((a: string) => ({
            child_id: cid, parent_id: child.parent_id, title: a, body: args.explanation, category: args.risk_level,
          })));
        }

        // Alertas: solo si score > 60 O riesgo alto. Para riesgo medio, verificar que no haya alerta en últimas 6h.
        const sevMap: Record<string,string> = { high: "critical", medium: "moderate", low: "preventive" };
        const shouldAlert = args.emotional_score > 60 || args.risk_level === "high";
        let mediumCooldownOk = false;
        if (args.risk_level === "medium" && args.emotional_score <= 60) {
          const { count } = await admin.from("alerts")
            .select("id", { count: "exact", head: true })
            .eq("child_id", cid)
            .gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString());
          mediumCooldownOk = (count ?? 0) === 0;
        }

        if (shouldAlert || mediumCooldownOk) {
          await admin.from("alerts").insert([{
            child_id: cid, parent_id: child.parent_id,
            severity: sevMap[args.risk_level] ?? "preventive",
            title: `[Análisis automático] Score ${args.emotional_score} — ${child.name}`,
            message: args.explanation,
          }]);
        }

        results.push({ child_id: cid, score: args.emotional_score, risk: args.risk_level });
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
