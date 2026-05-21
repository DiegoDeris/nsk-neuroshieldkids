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
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER rules_touch BEFORE UPDATE ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();