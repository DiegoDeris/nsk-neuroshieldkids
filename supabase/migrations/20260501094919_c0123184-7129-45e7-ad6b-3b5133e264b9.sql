-- Token único de ingesta por hijo
ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS ingest_token text UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS last_ingest_at timestamptz;

-- Backfill por si había filas previas
UPDATE public.children SET ingest_token = encode(gen_random_bytes(24), 'hex') WHERE ingest_token IS NULL;

-- Origen de cada métrica
ALTER TABLE public.usage_metrics
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','api','csv','cron'));

-- Tabla de eventos brutos enviados por dispositivos / shortcuts / tasker
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  app_name text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0 AND duration_seconds <= 86400),
  event_type text NOT NULL DEFAULT 'app_usage' CHECK (event_type IN ('app_usage','session_start','session_end','screen_on','screen_off')),
  source text NOT NULL DEFAULT 'api' CHECK (source IN ('api','csv','manual')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_child_date_idx ON public.usage_events (child_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_parent_idx ON public.usage_events (parent_id);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events select own" ON public.usage_events FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "events insert own" ON public.usage_events FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "events delete own" ON public.usage_events FOR DELETE USING (auth.uid() = parent_id);

-- Función para agregar eventos del día a usage_metrics
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

  SELECT COALESCE(SUM(duration_seconds)/60, 0)::int INTO _total
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'app_usage';

  SELECT COALESCE(SUM(duration_seconds)/60, 0)::int INTO _night
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day
    AND event_type = 'app_usage'
    AND (EXTRACT(HOUR FROM occurred_at) >= 22 OR EXTRACT(HOUR FROM occurred_at) < 7);

  SELECT COUNT(*)::int INTO _sessions
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type IN ('session_start','screen_on');

  SELECT app_name INTO _dominant
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'app_usage' AND app_name IS NOT NULL
  GROUP BY app_name ORDER BY SUM(duration_seconds) DESC LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(app_name, mins), '{}'::jsonb) INTO _breakdown
  FROM (
    SELECT app_name, (SUM(duration_seconds)/60)::int AS mins
    FROM public.usage_events
    WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'app_usage' AND app_name IS NOT NULL
    GROUP BY app_name
  ) t;

  INSERT INTO public.usage_metrics (child_id, parent_id, metric_date, total_minutes, night_minutes, sessions, dominant_app, app_breakdown, source)
  VALUES (_child_id, _parent, _day, _total, _night, _sessions, _dominant, _breakdown, 'api')
  ON CONFLICT (child_id, metric_date) DO UPDATE SET
    total_minutes = EXCLUDED.total_minutes,
    night_minutes = EXCLUDED.night_minutes,
    sessions = EXCLUDED.sessions,
    dominant_app = EXCLUDED.dominant_app,
    app_breakdown = EXCLUDED.app_breakdown,
    source = CASE WHEN public.usage_metrics.source = 'manual' THEN 'manual' ELSE EXCLUDED.source END;
END;
$$;