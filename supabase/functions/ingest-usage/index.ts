// ingest-usage v3 — evalúa reglas, aplica freemium, evita double-counting
// POST body: { token: string, events: [{app_name, duration_seconds, occurred_at?, event_type?, metadata?}] }
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(): Record<string, string> {
  return {
    "apikey": SB_KEY,
    "Authorization": `Bearer ${SB_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };
}

async function sbGet(table: string, qs: string): Promise<unknown> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, { headers: sbHeaders() });
  return r.json();
}

async function sbPatch(table: string, qs: string, data: unknown): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify(data),
  });
}

async function sbInsert(table: string, rows: unknown[]): Promise<{ status: number; text: string }> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(rows),
  });
  const text = await r.text();
  return { status: r.status, text };
}

// Upsert vía PostgREST (equivalente a supabase-js .upsert(...).onConflict(...))
async function sbUpsert(table: string, rows: unknown[], onConflict: string): Promise<{ status: number; text: string }> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  const text = await r.text();
  return { status: r.status, text };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Evaluación de reglas ──────────────────────────────────────────────────────

async function evaluateRules(
  childId: string,
  parentId: string,
  metric: { total_minutes: number; night_minutes: number; sessions: number; dominant_app: string | null },
  events: Array<{ app_name: string | null; occurred_at: string; duration_seconds: number }>,
) {
  const rules = (await sbGet(
    "rules",
    `select=id,rule_type,config,severity,cooldown_minutes,last_triggered_at&parent_id=eq.${parentId}&enabled=eq.true&or=(child_id.eq.${childId},child_id.is.null)`,
  )) as Array<{
    id: string;
    rule_type: string;
    config: Record<string, unknown>;
    severity: string;
    cooldown_minutes: number;
    last_triggered_at: string | null;
  }>;

  if (!Array.isArray(rules) || rules.length === 0) return;

  const now = Date.now();
  const alertsToInsert: Array<{ child_id: string; parent_id: string; severity: string; title: string; message: string }> = [];

  for (const rule of rules) {
    // Comprobar cooldown
    if (rule.last_triggered_at) {
      const elapsed = (now - new Date(rule.last_triggered_at).getTime()) / 60000;
      if (elapsed < rule.cooldown_minutes) continue;
    }

    const cfg = rule.config ?? {};
    let triggered = false;
    let title = "";
    let message = "";

    switch (rule.rule_type) {
      case "daily_time_limit": {
        const limit = Number(cfg.minutes ?? 120);
        if (metric.total_minutes >= limit) {
          triggered = true;
          title = "Límite diario de pantalla alcanzado";
          message = `Lleva ${metric.total_minutes} min de pantalla hoy (límite: ${limit} min).`;
        }
        break;
      }
      case "forbidden_app": {
        const apps = (cfg.apps as string[] ?? []).map((a: string) => a.toLowerCase().trim());
        const hit = events.find(e => e.app_name && apps.some(a => e.app_name!.toLowerCase().includes(a)));
        if (hit) {
          triggered = true;
          title = `App prohibida detectada: ${hit.app_name}`;
          message = `Se detectó uso de "${hit.app_name}", que está en la lista de apps prohibidas.`;
        }
        break;
      }
      case "app_time_limit": {
        const appName = String(cfg.app ?? "").toLowerCase();
        const limit = Number(cfg.minutes ?? 60);
        const appMinutes = Math.round(
          events
            .filter(e => e.app_name && e.app_name.toLowerCase().includes(appName))
            .reduce((s, e) => s + (e.duration_seconds ?? 0), 0) / 60,
        );
        if (appMinutes >= limit) {
          triggered = true;
          title = `Límite de ${cfg.app} alcanzado`;
          message = `Se han registrado más de ${limit} min en ${cfg.app} hoy.`;
        }
        break;
      }
      case "restricted_hours": {
        const startH = Number(cfg.start_hour ?? 22);
        const endH = Number(cfg.end_hour ?? 7);
        const nightEvent = events.find(e => {
          const h = new Date(e.occurred_at).getHours();
          return startH > endH
            ? h >= startH || h < endH
            : h >= startH && h < endH;
        });
        if (nightEvent) {
          triggered = true;
          title = "Uso en horario restringido";
          message = `Se detectó actividad a las ${new Date(nightEvent.occurred_at).toLocaleTimeString("es")} (horario restringido: ${startH}h–${endH}h).`;
        }
        break;
      }
      case "session_burst": {
        const windowMin = Number(cfg.window_minutes ?? 10);
        const maxSessions = Number(cfg.max_sessions ?? 8);
        const windowStart = new Date(now - windowMin * 60000).toISOString();
        const recentEvents = events.filter(e => e.occurred_at >= windowStart);
        if (recentEvents.length >= maxSessions) {
          triggered = true;
          title = "Uso compulsivo detectado";
          message = `${recentEvents.length} aperturas en los últimos ${windowMin} minutos.`;
        }
        break;
      }
    }

    if (triggered) {
      alertsToInsert.push({ child_id: childId, parent_id: parentId, severity: rule.severity, title, message });
      await sbPatch("rules", `id=eq.${rule.id}`, { last_triggered_at: new Date().toISOString() });
    }
  }

  if (alertsToInsert.length > 0) {
    await sbInsert("alerts", alertsToInsert);
  }
}

// ── Rate limiting por token (persistente, tabla ingest_rate_limits) ─────────
// Máx 20 batches por minuto por token para prevenir abuso
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const rows = (await sbGet(
    "ingest_rate_limits",
    `select=token_hash,window_start,request_count&token_hash=eq.${tokenHash}&limit=1`,
  )) as Array<{ token_hash: string; window_start: string; request_count: number }>;

  const existing = Array.isArray(rows) ? rows[0] : undefined;

  if (!existing || (nowMs - new Date(existing.window_start).getTime() > RATE_LIMIT_WINDOW_MS)) {
    // Nueva ventana: resetear
    await sbUpsert("ingest_rate_limits", [{
      token_hash: tokenHash,
      window_start: nowIso,
      request_count: 1,
      updated_at: nowIso,
    }], "token_hash");
    return true;
  }

  if (existing.request_count >= RATE_LIMIT_MAX) return false;

  await sbUpsert("ingest_rate_limits", [{
    token_hash: tokenHash,
    window_start: existing.window_start,
    request_count: existing.request_count + 1,
    updated_at: nowIso,
  }], "token_hash");
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const rawText = await req.text().catch(() => "{}");
    const body = (() => { try { return JSON.parse(rawText); } catch { return {}; } })();
    const token = String(body.token ?? "").trim();
    const evtsRaw: unknown[] = Array.isArray(body.events) ? body.events : [];

    // Rate limiting — verificar antes de procesar
    if (token && !(await checkRateLimit(token))) {
      return json({ error: "rate limit exceeded — max 20 batches per minute" }, 429);
    }

    if (!token || token.length < 16 || token.length > 128) {
      return json({ error: "token requerido" }, 401);
    }
    if (evtsRaw.length === 0 || evtsRaw.length > 500) {
      return json({ error: "events: 1..500" }, 400);
    }

    // Buscar hijo por token
    const kids = (await sbGet(
      "children",
      `select=id,parent_id,name&ingest_token=eq.${encodeURIComponent(token)}&limit=1`,
    )) as Array<{ id: string; parent_id: string; name: string }>;

    if (!Array.isArray(kids) || kids.length === 0) {
      return json({ error: "token inválido" }, 401);
    }
    const child = kids[0];
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Normalizar eventos
    const rows = evtsRaw.map((e: unknown) => {
      const ev = e as Record<string, unknown>;
      const dur = Math.max(0, Math.min(86400, Number(ev.duration_seconds ?? 0) | 0));
      const occurred = ev.occurred_at ? String(ev.occurred_at) : now;
      const app = ev.app_name ? String(ev.app_name).slice(0, 80) : null;
      const meta = ev.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
      return {
        child_id: child.id,
        parent_id: child.parent_id,
        occurred_at: occurred,
        app_name: app,
        duration_seconds: dur,
        event_type: "app_usage",
        source: "api",
        metadata: meta,
      };
    });

    // Insertar eventos brutos
    const ins = await sbInsert("usage_events", rows);
    if (ins.status >= 300) {
      console.error("insert error:", ins.text);
      return json({ error: "insert failed", detail: ins.text }, 500);
    }

    // ── Recalcular métrica del día desde todos los eventos (evita double-counting) ──
    const todayNextDay = new Date(today + "T00:00:00Z"); todayNextDay.setDate(todayNextDay.getDate() + 1);
    const tomorrowDate = todayNextDay.toISOString().slice(0, 10);
    const allEvents = (await sbGet(
      "usage_events",
      `select=duration_seconds,occurred_at,app_name&child_id=eq.${child.id}&occurred_at=gte.${today}T00:00:00Z&occurred_at=lt.${tomorrowDate}T00:00:00Z&event_type=eq.app_usage`,
    )) as Array<{ duration_seconds: number; occurred_at: string; app_name: string | null }>;

    const totalMinutes = Math.round(allEvents.reduce((s, e) => s + (e.duration_seconds ?? 0), 0) / 60);
    const nightMinutes = Math.round(allEvents.reduce((s, e) => {
      const h = new Date(e.occurred_at).getHours();
      return s + ((h >= 22 || h < 7) ? (e.duration_seconds ?? 0) : 0);
    }, 0) / 60);
    const sessions = allEvents.length;

    // App dominante
    const appCounts: Record<string, number> = {};
    for (const e of allEvents) {
      if (e.app_name) appCounts[e.app_name] = (appCounts[e.app_name] ?? 0) + (e.duration_seconds ?? 0);
    }
    const dominantApp = Object.keys(appCounts).sort((a, b) => appCounts[b] - appCounts[a])[0] ?? null;

    // Upsert métrica (ON CONFLICT reemplaza el valor calculado, no acumula)
    const existingMetric = (await sbGet(
      "usage_metrics",
      `select=id&child_id=eq.${child.id}&metric_date=eq.${today}&limit=1`,
    )) as Array<{ id: string }>;

    if (existingMetric.length > 0) {
      await sbPatch("usage_metrics", `id=eq.${existingMetric[0].id}`, {
        total_minutes: totalMinutes,
        night_minutes: nightMinutes,
        sessions,
        dominant_app: dominantApp,
      });
    } else {
      await sbInsert("usage_metrics", [{
        child_id: child.id,
        parent_id: child.parent_id,
        metric_date: today,
        total_minutes: totalMinutes,
        night_minutes: nightMinutes,
        sessions,
        dominant_app: dominantApp,
        source: "api",
      }]);
    }

    // Actualizar last_ingest_at
    await sbPatch("children", `id=eq.${child.id}`, { last_ingest_at: now });

    // ── Evaluar reglas ──
    await evaluateRules(
      child.id,
      child.parent_id,
      { total_minutes: totalMinutes, night_minutes: nightMinutes, sessions, dominant_app: dominantApp },
      rows.map(r => ({ app_name: r.app_name, occurred_at: r.occurred_at, duration_seconds: r.duration_seconds })),
    );

    return json({ ok: true, child_id: child.id, child_name: child.name, ingested: rows.length });
  } catch (e) {
    console.error("ingest-usage crash:", e);
    return json({ error: String(e) }, 500);
  }
});
