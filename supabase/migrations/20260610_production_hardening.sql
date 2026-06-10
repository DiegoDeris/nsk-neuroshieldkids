-- ============================================================
-- PRODUCTION HARDENING — 2026-06-10
-- Cierra hallazgos críticos/altos de la auditoría QA end-to-end
-- ============================================================

-- ── 1. app_settings: tabla referenciada por fn_notify_alert pero inexistente ──
-- Sin esta tabla, fn_notify_alert lanzaba "relation does not exist" y
-- abortaba el INSERT en alerts (las alertas dejaban de crearse).
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- Sin policies = solo accesible vía service_role

-- ── 2. cron_failures: registro de fallos de jobs/triggers para alertar ──
CREATE TABLE IF NOT EXISTS public.cron_failures (
  id          BIGSERIAL PRIMARY KEY,
  job_name    TEXT NOT NULL,
  error       TEXT NOT NULL,
  context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cron_failures_job_time ON public.cron_failures(job_name, occurred_at DESC);
ALTER TABLE public.cron_failures ENABLE ROW LEVEL SECURITY;

-- ── 3. failed_webhooks: tracking de eventos de proveedor (Stripe) fallidos ──
CREATE TABLE IF NOT EXISTS public.failed_webhooks (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_id     TEXT,
  event_type   TEXT,
  payload      JSONB,
  error        TEXT NOT NULL,
  retry_count  INT NOT NULL DEFAULT 0,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_unresolved ON public.failed_webhooks(resolved, occurred_at DESC);
ALTER TABLE public.failed_webhooks ENABLE ROW LEVEL SECURITY;

-- ── 4. fn_notify_alert: blindar contra cualquier excepción ──
-- Si app_settings/net.http_post fallan, NUNCA debe abortar el INSERT en alerts.
-- El error queda registrado en cron_failures para alertar al operador.
CREATE OR REPLACE FUNCTION fn_notify_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_secret TEXT;
BEGIN
  BEGIN
    SELECT value INTO v_secret FROM public.app_settings WHERE key = 'notify_alert_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  BEGIN
    PERFORM net.http_post(
      url := 'https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/notify-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', COALESCE(v_secret, 'e78ab5c5d16053c5c291fcf5958bea16a62c34b009bd591ff497accc67861e89')
      ),
      body := jsonb_build_object(
        'type', 'INSERT', 'table', 'alerts', 'schema', 'public', 'record', row_to_json(NEW)
      )::text
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.cron_failures(job_name, error, context)
    VALUES ('fn_notify_alert', SQLERRM, jsonb_build_object('alert_id', NEW.id));
  END;

  RETURN NEW;
END;
$$;

-- ── 5. emotional_scores: política UPDATE faltante ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='emotional_scores' AND policyname='scores update own'
  ) THEN
    EXECUTE 'CREATE POLICY "scores update own" ON public.emotional_scores FOR UPDATE USING (auth.uid() = parent_id)';
  END IF;
END$$;

-- ── 6. handle_new_user: idempotente ante doble ejecución del trigger ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, plan) VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── 7. cleanup_old_usage_events: no debe fallar en silencio ──
CREATE OR REPLACE FUNCTION public.cleanup_old_usage_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.usage_events WHERE occurred_at < now() - INTERVAL '365 days';
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.cron_failures(job_name, error) VALUES ('cleanup_old_usage_events', SQLERRM);
END;
$$;

-- ── 8. aggregate_events_to_metric: app_breakdown en minutos (no segundos) ──
-- total_minutes/night_minutes ya están en minutos; app_breakdown quedaba en
-- segundos brutos, 60x mayor — inconsistente para cualquier consumidor.
CREATE OR REPLACE FUNCTION public.aggregate_events_to_metric(_child_id uuid, _day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _parent uuid;
  _total int;
  _night int;
  _sessions int;
  _dominant text;
  _breakdown jsonb;
  _behavioral jsonb;
BEGIN
  SELECT parent_id INTO _parent FROM public.children WHERE id = _child_id;
  IF _parent IS NULL THEN RETURN; END IF;

  -- Tiempo total de app_usage
  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _total
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage';

  -- Uso nocturno: 22:00–07:00 hora local Europe/Madrid
  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _night
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage'
    AND (EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Europe/Madrid') >= 22
      OR EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Europe/Madrid') < 7);

  -- Sesiones: session_start o distinct apps como heurística
  SELECT COUNT(*)::int INTO _sessions
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'session_start';

  IF _sessions = 0 THEN
    SELECT COUNT(DISTINCT app_name)::int INTO _sessions
    FROM public.usage_events
    WHERE child_id = _child_id
      AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
      AND event_type = 'app_usage'
      AND app_name IS NOT NULL;
  END IF;

  -- App dominante
  SELECT app_name INTO _dominant
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage'
    AND app_name IS NOT NULL
  GROUP BY app_name
  ORDER BY SUM(duration_seconds) DESC
  LIMIT 1;

  -- Breakdown por app — en MINUTOS (consistente con total_minutes/night_minutes)
  SELECT COALESCE(
    jsonb_object_agg(app_name, mins),
    '{}'::jsonb
  ) INTO _breakdown
  FROM (
    SELECT app_name, (SUM(duration_seconds) / 60)::int AS mins
    FROM public.usage_events
    WHERE child_id = _child_id
      AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
      AND event_type = 'app_usage'
      AND app_name IS NOT NULL
    GROUP BY app_name
  ) t;

  -- Señales conductuales agregadas desde metadata
  SELECT jsonb_build_object(
    'interactions_per_min',  COALESCE(AVG((metadata->>'interactions_per_min')::numeric), 0),
    'visibility_changes',    COALESCE(SUM((metadata->>'visibility_changes')::int), 0),
    'orientation_changes',   COALESCE(SUM((metadata->>'orientation_changes')::int), 0),
    'battery_drain_percent', COALESCE(AVG((metadata->>'battery_drain_percent')::numeric), 0),
    'session_minutes',       COALESCE(AVG((metadata->>'session_minutes')::numeric), 0),
    'event_count',           COUNT(*)
  ) INTO _behavioral
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND metadata IS NOT NULL
    AND metadata != '{}'::jsonb;

  INSERT INTO public.usage_metrics (
    child_id, parent_id, metric_date,
    total_minutes, night_minutes, sessions,
    dominant_app, app_breakdown, behavioral_signals, source
  ) VALUES (
    _child_id, _parent, _day,
    _total, _night, _sessions,
    _dominant, _breakdown, COALESCE(_behavioral, '{}'::jsonb), 'api'
  )
  ON CONFLICT (child_id, metric_date) DO UPDATE SET
    total_minutes      = EXCLUDED.total_minutes,
    night_minutes      = EXCLUDED.night_minutes,
    sessions           = EXCLUDED.sessions,
    dominant_app       = EXCLUDED.dominant_app,
    app_breakdown      = EXCLUDED.app_breakdown,
    behavioral_signals = EXCLUDED.behavioral_signals,
    updated_at         = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) TO service_role;

-- ── 9. Índices en parent_id para queries de listado a escala ──
CREATE INDEX IF NOT EXISTS idx_scores_parent        ON public.emotional_scores(parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pred_parent          ON public.predictions(parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_parent           ON public.recommendations(parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gamification_parent  ON public.gamification(parent_id);
CREATE INDEX IF NOT EXISTS idx_quests_parent        ON public.quests(parent_id, status);

-- ── 10. profiles.lessons_done: columna usada por Learn.tsx pero inexistente ──
-- Sin esta columna, el progreso de la sección "Aprende" (src/pages/Learn.tsx)
-- nunca se guarda ni se carga (select/update fallan en PostgREST).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lessons_done JSONB NOT NULL DEFAULT '[]'::jsonb;
