-- Schedule daily-analysis edge function via pg_cron + pg_net
-- Runs every day at 08:00 UTC for all children with data.
-- The anon key is intentionally public (same as VITE_SUPABASE_PUBLISHABLE_KEY in client).
-- The function authenticates internally with the service_role key (Supabase auto-injects it).

-- Enable required extensions (idempotent)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any existing job with this name to avoid duplicates on re-run
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-analysis-cron') then
    perform cron.unschedule('daily-analysis-cron');
  end if;
end;
$$;

-- Schedule: 08:00 UTC every day
select cron.schedule(
  'daily-analysis-cron',
  '0 8 * * *',
  $$
  select
    net.http_post(
      url     := 'https://lqvgspmjfkfdurdnejzs.supabase.co/functions/v1/daily-analysis',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxdmdzcG1qZmtmZHVyZG5lanpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxMzcsImV4cCI6MjA5NDk3MDEzN30.wocGhw9oj96-GAKNNFYai_KciAuZfs4jO_oMqbOkXuo"}'::jsonb,
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
