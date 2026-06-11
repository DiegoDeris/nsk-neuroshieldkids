-- ============================================================
-- CRON CONSOLIDATION — 2026-06-10
-- Cierra hallazgos QA #15 (ALTO) y #33 (BAJO)
-- ============================================================
--
-- #15: 20260522080000_schedule_daily_analysis.sql y
--      20260608_daily_analysis_cron.sql documentaban el cron de
--      daily-analysis de forma contradictoria (una crea el job vía
--      cron.schedule con nombre 'daily-analysis-cron' a las 08:00 UTC;
--      la otra afirma que el job se gestiona desde el Dashboard UI y
--      "no ejecutar"). Ambas migraciones quedan ARCHIVADAS sin
--      modificarse (son append-only y pueden estar ya aplicadas).
--
-- ESTA MIGRACIÓN ES LA ÚNICA FUENTE DE VERDAD para el cron job de
-- daily-analysis. Supersede a 20260522080000 y 20260608.
--   - Nombre canónico del job: 'daily-analysis-cron'
--   - Horario canónico:        06:00 UTC ('0 6 * * *')
--   - Limpia cualquier job duplicado/obsoleto (incl. el de 08:00 UTC
--     y cualquier nombre alternativo que se haya creado manualmente
--     desde el Dashboard, p.ej. 'daily-analysis').
--
-- #33: El job anterior incrustaba un JWT (anon key) en texto plano en
--      el header Authorization del body de cron.schedule. Si se rota
--      la key, el cron queda roto en silencio sin que se note hasta
--      revisar logs. Se sustituye por un secret propio (CRON_SECRET),
--      enviado en el header `x-cron-secret`, siguiendo el mismo patrón
--      que fn_notify_alert() (sección 4 de
--      20260610_production_hardening.sql): se lee desde
--      app_settings (key='cron_secret') con fallback hardcoded de
--      emergencia. daily-analysis/index.ts valida este header de forma
--      fail-closed (rechaza con 500 si CRON_SECRET no está configurado
--      como secret de la edge function, y con 401 si no coincide).
--
-- Rotación: para rotar el secret, actualizar AMBOS valores:
--   1. Supabase Edge Functions → daily-analysis → Secrets → CRON_SECRET
--   2. UPDATE public.app_settings SET value = '<nuevo>' WHERE key = 'cron_secret';
--      (o INSERT si no existe la fila)
-- ============================================================

DO $$
BEGIN
  -- Habilitar extensiones requeridas (idempotente)
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- ── Limpieza de jobs obsoletos/duplicados ──────────────────
  -- Job creado por 20260522080000 (08:00 UTC, JWT en texto plano)
  BEGIN
    PERFORM cron.unschedule('daily-analysis-cron');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- el job puede no existir
  END;

  -- Posible nombre alternativo creado manualmente desde el Dashboard
  -- (referenciado por 20260608_daily_analysis_cron.sql)
  BEGIN
    PERFORM cron.unschedule('daily-analysis');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- el job puede no existir
  END;

  -- ── Job canónico: daily-analysis-cron @ 06:00 UTC ──────────
  -- Header x-cron-secret en lugar de Authorization: Bearer <JWT>.
  PERFORM cron.schedule(
    'daily-analysis-cron',
    '0 6 * * *',
    $job$
    select
      net.http_post(
        url     := 'https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/daily-analysis',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', COALESCE(
            (SELECT value FROM public.app_settings WHERE key = 'cron_secret' LIMIT 1),
            'b3f6e9c2a8d14f7091c5b2e6a7d8f3c4e1b9a0d6f2c8e5b7a1d3f9c0e4b6a2d8'
          )
        ),
        body    := '{}'::jsonb
      ) as request_id;
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron / pg_net no disponibles en este entorno (p.ej. local/CI):
  -- no debe romper la migración.
  NULL;
END$$;
