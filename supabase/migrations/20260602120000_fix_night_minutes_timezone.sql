-- Fix night_minutes: usa Europe/Madrid en vez de UTC
-- Anteriormente 8:54 local (UTC+2) = 6:54 UTC → contaba como nocturno incorrectamente

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

  -- Breakdown por app
  SELECT COALESCE(
    jsonb_object_agg(app_name, total_sec),
    '{}'::jsonb
  ) INTO _breakdown
  FROM (
    SELECT app_name, SUM(duration_seconds) AS total_sec
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
