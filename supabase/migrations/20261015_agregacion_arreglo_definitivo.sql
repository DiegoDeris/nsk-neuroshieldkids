-- Dos fallos en aggregate_events_to_metric. Entre los dos, el análisis
-- diario NO HA FUNCIONADO NUNCA, ni una vez, para ningún niño.
--
-- 1. Escribía en usage_metrics.updated_at, una columna que no existe. La
--    función fallaba siempre. daily-analysis ignoraba ese error, no creaba
--    la métrica del día y salía por el continue, respondiendo "0 niños
--    procesados, 0 fallos" como si no hubiera nada que analizar.
--
-- 2. Reconstruía behavioral_signals con los campos del monitor web retirado
--    (interactions_per_min, visibility_changes…) y descartaba todo lo que
--    envía la app nativa, sobrescribiendo además lo que ingest-usage había
--    guardado bien. Aunque (1) no existiera, el motor habría visto un día
--    sin medición y habría dicho "no se puede evaluar" cada mañana.
--
-- Se añade updated_at en lugar de borrar la línea: saber cuándo se recalculó
-- una métrica es información útil.

alter table public.usage_metrics
  add column if not exists updated_at timestamptz not null default now();

CREATE OR REPLACE FUNCTION public.aggregate_events_to_metric(_child_id uuid, _day date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _parent uuid; _total int; _night int; _sessions int;
  _dominant text; _breakdown jsonb; _behavioral jsonb;
BEGIN
  SELECT parent_id INTO _parent FROM public.children WHERE id = _child_id;
  IF _parent IS NULL THEN RETURN; END IF;

  -- __signals__ transporta las señales nativas; no es una app que el niño
  -- use. Dura 0 segundos pero contaba como app distinta e inflaba sesiones.
  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _total
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage' AND COALESCE(app_name,'') <> '__signals__';

  SELECT COALESCE(SUM(duration_seconds) / 60, 0)::int INTO _night
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage' AND COALESCE(app_name,'') <> '__signals__'
    AND (EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Europe/Madrid') >= 22
      OR EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Europe/Madrid') < 7);

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
      AND event_type = 'app_usage' AND app_name IS NOT NULL
      AND app_name <> '__signals__';
  END IF;

  SELECT app_name INTO _dominant
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND event_type = 'app_usage' AND app_name IS NOT NULL
    AND app_name <> '__signals__'
  GROUP BY app_name ORDER BY SUM(duration_seconds) DESC LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(app_name, mins), '{}'::jsonb) INTO _breakdown
  FROM (
    SELECT app_name, (SUM(duration_seconds) / 60)::int AS mins
    FROM public.usage_events
    WHERE child_id = _child_id
      AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
      AND event_type = 'app_usage' AND app_name IS NOT NULL
      AND app_name <> '__signals__'
    GROUP BY app_name
  ) t;

  -- Señales tal cual las midió el dispositivo. No se derivan aquí.
  SELECT metadata INTO _behavioral
  FROM public.usage_events
  WHERE child_id = _child_id
    AND (occurred_at AT TIME ZONE 'Europe/Madrid')::date = _day
    AND metadata->>'source' IN ('android_native','ios_native')
  ORDER BY occurred_at DESC LIMIT 1;

  INSERT INTO public.usage_metrics (
    child_id, parent_id, metric_date, total_minutes, night_minutes, sessions,
    dominant_app, app_breakdown, behavioral_signals, source
  ) VALUES (
    _child_id, _parent, _day, _total, _night, _sessions,
    _dominant, _breakdown, COALESCE(_behavioral,'{}'::jsonb), 'api'
  )
  ON CONFLICT (child_id, metric_date) DO UPDATE SET
    total_minutes = EXCLUDED.total_minutes,
    night_minutes = EXCLUDED.night_minutes,
    sessions      = EXCLUDED.sessions,
    dominant_app  = EXCLUDED.dominant_app,
    app_breakdown = EXCLUDED.app_breakdown,
    -- Nunca se destruye una medición buena con un vacío.
    behavioral_signals = CASE
      WHEN EXCLUDED.behavioral_signals IS NULL
        OR EXCLUDED.behavioral_signals = '{}'::jsonb
      THEN public.usage_metrics.behavioral_signals
      ELSE EXCLUDED.behavioral_signals END,
    updated_at = now();
END;
$function$;
