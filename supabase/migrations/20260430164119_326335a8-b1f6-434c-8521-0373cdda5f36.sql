
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

-- Children
CREATE TABLE public.children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INT NOT NULL CHECK (age >= 3 AND age <= 18),
  avatar_emoji TEXT DEFAULT '🧒',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
CREATE POLICY "children select own" ON public.children FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "children insert own" ON public.children FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "children update own" ON public.children FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "children delete own" ON public.children FOR DELETE USING (auth.uid() = parent_id);

-- Usage metrics
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, metric_date)
);
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metrics select own" ON public.usage_metrics FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "metrics insert own" ON public.usage_metrics FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "metrics update own" ON public.usage_metrics FOR UPDATE USING (auth.uid() = parent_id);
CREATE POLICY "metrics delete own" ON public.usage_metrics FOR DELETE USING (auth.uid() = parent_id);
CREATE INDEX idx_metrics_child_date ON public.usage_metrics(child_id, metric_date DESC);

-- Emotional scores
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

-- Alerts
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

-- Recommendations
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

-- Subscriptions
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

-- Gamification
CREATE TABLE public.gamification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL UNIQUE REFERENCES public.children(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points INT NOT NULL DEFAULT 0,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gamification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gam select own" ON public.gamification FOR SELECT USING (auth.uid() = parent_id);
CREATE POLICY "gam insert own" ON public.gamification FOR INSERT WITH CHECK (auth.uid() = parent_id);
CREATE POLICY "gam update own" ON public.gamification FOR UPDATE USING (auth.uid() = parent_id);

-- Trigger: create profile + free subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.subscriptions (user_id, plan) VALUES (NEW.id, 'free');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime for alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER TABLE public.alerts REPLICA IDENTITY FULL;
