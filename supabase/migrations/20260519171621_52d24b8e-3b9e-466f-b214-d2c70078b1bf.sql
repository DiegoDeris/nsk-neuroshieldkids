-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE TABLE public.children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INT NOT NULL CHECK (age >= 3 AND age <= 18),
  avatar_emoji TEXT DEFAULT '🧒',
  ingest_token text UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  last_ingest_at timestamptz,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
CREATE POLICY "children select own" ON public.children FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "children insert own" ON public.children FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "children update own" ON public.children FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "children delete own" ON public.children FOR DELETE USING (auth.uid() = parent_id);

CREATE TABLE public.usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  total_minutes INT NOT NULL DEFAULT 0,
  night_minutes INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  dominant_app TEXT,
  app_breakdown JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','api','csv','cron')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, metric_date)
);
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metrics select own" ON public.usage_metrics FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "metrics insert own" ON public.usage_metrics FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "metrics update own" ON public.usage_metrics FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "metrics delete own" ON public.usage_metrics FOR DELETE USING (auth.uid() = parent_id);
CREATE INDEX idx_metrics_child_date ON public.usage_metrics(child_id, metric_date DESC);

CREATE TABLE public.emotional_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  patterns JSONB DEFAULT '[]'::jsonb,
  explanation TEXT,
  actions JSONB DEFAULT '[]'::jsonb,
  source_metric_id UUID REFERENCES public.usage_metrics(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.emotional_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scores select own" ON public.emotional_scores FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "scores insert own" ON public.emotional_scores FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE INDEX idx_scores_child ON public.emotional_scores(child_id, created_at DESC);

CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('preventive','moderate','critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts select own" ON public.alerts FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "alerts insert own" ON public.alerts FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "alerts update own" ON public.alerts FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "alerts delete own" ON public.alerts FOR DELETE USING (auth.uid() = parent_id);

CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec select own" ON public.recommendations FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "rec insert own" ON public.recommendations FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "rec update own" ON public.recommendations FOR UPDATE USING (auth.uid() = parent_id);

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','basic','premium')),
  status TEXT NOT NULL DEFAULT 'active',
  free_analyses_used INT NOT NULL DEFAULT 0,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub select own" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sub insert own" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sub update own" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE public.gamification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL UNIQUE REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points INT NOT NULL DEFAULT 0,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  streak_days integer NOT NULL DEFAULT 0,
  last_healthy_date date,
  level integer NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gamification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gam select own" ON public.gamification FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "gam insert own" ON public.gamification FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "gam update own" ON public.gamification FOR UPDATE USING (auth.uid() = parent_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.subscriptions (user_id, plan) VALUES (NEW.id, 'free');
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.usage_events (
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
CREATE INDEX usage_events_child_date_idx ON public.usage_events (child_id, occurred_at DESC);
CREATE INDEX usage_events_parent_idx ON public.usage_events (parent_id);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events select own" ON public.usage_events FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "events insert own" ON public.usage_events FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "events delete own" ON public.usage_events FOR DELETE USING (auth.uid() = parent_id);

CREATE OR REPLACE FUNCTION public.aggregate_events_to_metric(_child_id uuid, _day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'app_usage'
    AND (EXTRACT(HOUR FROM occurred_at) >= 22 OR EXTRACT(HOUR FROM occurred_at) < 6);

  SELECT COUNT(*)::int INTO _sessions
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'session_start';

  SELECT app_name INTO _dominant
  FROM public.usage_events
  WHERE child_id = _child_id AND occurred_at::date = _day AND event_type = 'app_usage' AND app_name IS NOT NULL
  GROUP BY app_name ORDER BY SUM(duration_seconds) DESC LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(app_name, mins), '{}'::jsonb) INTO _breakdown
  FROM (
    SELECT app_name, SUM(duration_seconds)/60 AS mins
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
REVOKE EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  child_id uuid,
  name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('forbidden_app','daily_time_limit','app_time_limit','restricted_hours','session_burst')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'moderate' CHECK (severity IN ('preventive','moderate','critical')),
  enabled boolean NOT NULL DEFAULT true,
  cooldown_minutes int NOT NULL DEFAULT 60,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rules_parent ON public.rules(parent_id) WHERE enabled = true;
CREATE INDEX idx_rules_child ON public.rules(child_id) WHERE enabled = true;
CREATE INDEX idx_usage_events_child_time ON public.usage_events(child_id, occurred_at DESC);
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rules select own" ON public.rules FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "rules insert own" ON public.rules FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "rules update own" ON public.rules FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "rules delete own" ON public.rules FOR DELETE USING (auth.uid() = parent_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER rules_touch BEFORE UPDATE ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  child_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'habit',
  points integer NOT NULL DEFAULT 10,
  target_days integer NOT NULL DEFAULT 1,
  progress integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quests select own" ON public.quests FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "quests insert own" ON public.quests FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "quests update own" ON public.quests FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "quests delete own" ON public.quests FOR DELETE USING (auth.uid() = parent_id);
CREATE INDEX idx_quests_child ON public.quests(child_id, status);
CREATE TRIGGER quests_touch BEFORE UPDATE ON public.quests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  child_id uuid NOT NULL,
  horizon_days integer NOT NULL DEFAULT 7,
  predicted_score integer NOT NULL,
  predicted_risk text NOT NULL,
  trend text NOT NULL,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  prevention_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 50,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pred select own" ON public.predictions FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "pred insert own" ON public.predictions FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE INDEX idx_pred_child ON public.predictions(child_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER TABLE public.alerts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quests;