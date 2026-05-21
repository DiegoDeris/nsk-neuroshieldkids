
-- Quests / retos personalizados accionables
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

-- Predicciones IA (forecast 7 días)
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

-- Streak en gamification
ALTER TABLE public.gamification
  ADD COLUMN IF NOT EXISTS streak_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_healthy_date date,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;

-- Habilitar realtime para usage_events (live feed) y predictions
ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quests;
