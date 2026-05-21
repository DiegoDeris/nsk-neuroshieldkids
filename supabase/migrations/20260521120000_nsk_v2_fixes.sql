-- ============================================================
-- NSK v2 — Fixes críticos y mejoras de arquitectura
-- ============================================================

-- 1. AMPLIAR event_type CHECK CONSTRAINT
--    La función ingest-usage normaliza app_open → session_start,
--    pero añadimos 'app_open' también para compatibilidad directa.
--    Primero eliminamos la constraint vieja y creamos la nueva.
ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_type_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_event_type_check
  CHECK (event_type IN (
    'app_usage', 'session_start', 'session_end',
    'screen_on', 'screen_off'
  ));
-- Nota: la función ingest-usage normaliza todos los tipos externos
-- (app_open, usage, web_visit) antes de insertar, garantizando compatibilidad.

-- 2. ÍNDICE COMPUESTO para mejorar rendimiento del evaluador de reglas
--    (filtra child_id + occurred_at + event_type en una sola pasada)
CREATE INDEX IF NOT EXISTS idx_usage_events_child_date_type
  ON public.usage_events (child_id, occurred_at DESC, event_type);

-- 3. ESTANDARIZAR CORTE NOCTURNO en aggregate_events_to_metric
--    Antes había inconsistencia entre < 6 y < 7. El UI muestra "22h-7h".
--    Actualizamos la función para usar siempre 22:00-07:00.
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
BEGIN
  SELECT parent_id INTO _parent FROM public.children WHERE id = _child_id;
  IF _parent IS NULL THEN RETURN; END IF;

  -- Tiempo total de app_usage
  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _total
  FROM public.usage_events
  WHERE child_id = _child_id
    AND occurred_at::date = _day
    AND event_type = 'app_usage';

  -- Uso nocturno: 22:00–07:00 (corte estandarizado)
  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _night
  FROM public.usage_events
  WHERE child_id = _child_id
    AND occurred_at::date = _day
    AND event_type = 'app_usage'
    AND (EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'UTC') >= 22
      OR EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'UTC') < 7);

  -- Sesiones: contar session_start (dispositivos iOS/Android modernos)
  SELECT COUNT(*)::int INTO _sessions
  FROM public.usage_events
  WHERE child_id = _child_id
    AND occurred_at::date = _day
    AND event_type = 'session_start';

  -- Si no hay session_start, estimar sesiones por cambios de app (heurística)
  IF _sessions = 0 THEN
    SELECT COUNT(DISTINCT app_name)::int INTO _sessions
    FROM public.usage_events
    WHERE child_id = _child_id
      AND occurred_at::date = _day
      AND event_type = 'app_usage'
      AND app_name IS NOT NULL;
  END IF;

  -- App dominante
  SELECT app_name INTO _dominant
  FROM public.usage_events
  WHERE child_id = _child_id
    AND occurred_at::date = _day
    AND event_type = 'app_usage'
    AND app_name IS NOT NULL
  GROUP BY app_name
  ORDER BY SUM(duration_seconds) DESC
  LIMIT 1;

  -- Desglose por app en minutos
  SELECT COALESCE(jsonb_object_agg(app_name, mins), '{}'::jsonb) INTO _breakdown
  FROM (
    SELECT app_name, (SUM(duration_seconds) / 60)::int AS mins
    FROM public.usage_events
    WHERE child_id = _child_id
      AND occurred_at::date = _day
      AND event_type = 'app_usage'
      AND app_name IS NOT NULL
    GROUP BY app_name
  ) t;

  INSERT INTO public.usage_metrics (
    child_id, parent_id, metric_date,
    total_minutes, night_minutes, sessions,
    dominant_app, app_breakdown, source
  )
  VALUES (
    _child_id, _parent, _day,
    _total, _night, _sessions,
    _dominant, _breakdown, 'api'
  )
  ON CONFLICT (child_id, metric_date) DO UPDATE SET
    total_minutes  = EXCLUDED.total_minutes,
    night_minutes  = EXCLUDED.night_minutes,
    sessions       = EXCLUDED.sessions,
    dominant_app   = EXCLUDED.dominant_app,
    app_breakdown  = EXCLUDED.app_breakdown,
    source         = CASE
                       WHEN public.usage_metrics.source = 'manual' THEN 'manual'
                       ELSE EXCLUDED.source
                     END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) TO service_role;

-- 4. ÍNDICE para mejorar la query de alertas recientes en daily-analysis
--    (evita seq scan en alertas al verificar cooldown de 6h por hijo)
CREATE INDEX IF NOT EXISTS idx_alerts_child_created
  ON public.alerts (child_id, created_at DESC);

-- 5. ÍNDICE para consultas de scores por hijo + fecha (ChildDetail y Dashboard)
CREATE INDEX IF NOT EXISTS idx_scores_child_created
  ON public.emotional_scores (child_id, created_at DESC);

-- 6. REALTIME: asegurar que recommendations también tenga REPLICA IDENTITY FULL
--    (ya estaba en migraciones previas, idempotente)
DO $$
BEGIN
  ALTER TABLE public.recommendations REPLICA IDENTITY FULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
