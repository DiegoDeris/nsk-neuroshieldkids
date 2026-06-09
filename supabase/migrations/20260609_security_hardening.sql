-- ============================================================
-- SECURITY HARDENING — 2026-06-09
-- ============================================================

-- ── 1. FIX CRÍTICO: RLS subscriptions ────────────────────────
-- Los usuarios NO deben poder modificar su propio plan/status.
-- Solo el webhook de Stripe (service_role, bypasea RLS) escribe en esta tabla.
DROP POLICY IF EXISTS "sub update own" ON public.subscriptions;
DROP POLICY IF EXISTS "sub insert own" ON public.subscriptions;

-- Los usuarios solo pueden LEER su propia suscripción.
-- Writes exclusivamente via service_role (stripe-webhook, daily-analysis).
-- "sub select own" ya existe — no se toca.

-- ── 2. Persistent idempotencia Stripe ────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id   TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Auto-cleanup de eventos > 30 días (evita crecimiento indefinido)
CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_ts
  ON public.processed_stripe_events(processed_at);

-- Solo service_role puede escribir aquí
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- Sin policies de usuario = nadie con anon key puede acceder

-- ── 3. Rate limiting ingest-usage: tabla de tracking ─────────
CREATE TABLE IF NOT EXISTS public.ingest_rate_limits (
  token_hash TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ingest_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sin policies = solo service_role

-- ── 4. DELETE policy en profiles (GDPR) ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "profiles delete own" ON public.profiles FOR DELETE USING (auth.uid() = id)';
  END IF;
END$$;

-- ── 5. DELETE policy en subscriptions para borrado de cuenta ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='subscriptions' AND policyname='sub delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "sub delete own" ON public.subscriptions FOR DELETE USING (auth.uid() = user_id)';
  END IF;
END$$;

-- ── 6. DELETE policies en tablas que faltan ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='emotional_scores' AND policyname='emotional_scores delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "emotional_scores delete own" ON public.emotional_scores FOR DELETE USING (auth.uid() = parent_id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='recommendations' AND policyname='recommendations delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "recommendations delete own" ON public.recommendations FOR DELETE USING (auth.uid() = parent_id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='predictions' AND policyname='predictions delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "predictions delete own" ON public.predictions FOR DELETE USING (auth.uid() = parent_id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='gamification' AND policyname='gamification delete own'
  ) THEN
    EXECUTE 'CREATE POLICY "gamification delete own" ON public.gamification FOR DELETE USING (auth.uid() = parent_id)';
  END IF;
END$$;

-- ── 7. TTL en usage_events (retención máx 1 año) ─────────────
-- Función que borra eventos con más de 365 días
CREATE OR REPLACE FUNCTION public.cleanup_old_usage_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.usage_events WHERE occurred_at < now() - INTERVAL '365 days';
END;
$$;

-- Cron semanal de limpieza (si pg_cron está disponible)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('cleanup-old-events', '0 3 * * 0', 'SELECT public.cleanup_old_usage_events()');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;
