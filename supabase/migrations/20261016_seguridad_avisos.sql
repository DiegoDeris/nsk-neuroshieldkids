-- ═══════════════════════════════════════════════════════════════════════════
--  Avisos de seguridad: lo que ya está aplicado en producción, escrito aquí
--  para que un redespliegue no lo deshaga en silencio (que es exactamente lo
--  que pasó con aggregate_events_to_metric).
--
--  Reaplicable tantas veces como haga falta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. search_path fijo en las funciones con permisos elevados ─────────────
-- Sin search_path fijo, quien pudiera crear una tabla o función con el mismo
-- nombre en otro esquema podría hacer que estas funciones ejecutaran su
-- código. Se fija el esquema sin tocar el cuerpo de las funciones.
do $$
begin
  if to_regprocedure('public.fn_notify_alert()') is not null then
    execute 'alter function public.fn_notify_alert() set search_path = public';
  end if;
  if to_regprocedure('public.cleanup_old_usage_events()') is not null then
    execute 'alter function public.cleanup_old_usage_events() set search_path = public';
  end if;
end $$;

-- ── 2. Nadie desde el navegador puede usar pg_net ──────────────────────────
-- pg_net hace peticiones HTTP desde dentro de la base de datos. Si una cuenta
-- cualquiera puede llamarlo, puede usar el servidor para alcanzar direcciones
-- internas. Solo lo necesita el cron, que corre como administrador.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    revoke usage on schema net from anon, authenticated;
    revoke all on all functions in schema net from anon, authenticated;
  end if;
end $$;

-- ── 3. Tablas internas: cerradas a cal y canto ─────────────────────────────
-- Secretos de configuración, fallos del cron, webhooks y control de abuso.
-- Nada de esto es de ningún usuario, así que nadie que entre por la app debe
-- poder leerlo ni escribirlo. Las funciones del servidor usan la clave de
-- servicio, que no pasa por estas reglas.
do $$
declare
  t text;
begin
  foreach t in array array['app_settings','cron_failures','failed_webhooks',
                           'ingest_rate_limits','processed_stripe_events']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', 'solo_servidor_' || t, t);
      execute format(
        'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        'solo_servidor_' || t, t);
    end if;
  end loop;
end $$;
