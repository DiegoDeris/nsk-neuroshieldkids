REVOKE EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_events_to_metric(uuid, date) TO service_role;