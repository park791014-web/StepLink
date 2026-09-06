-- REVIEW/APPROVAL REQUIRED. Do not run as part of client deployment.
-- Supabase Dashboard > Integrations > Cron can register the equivalent job.
create extension if not exists pg_cron;

select cron.schedule(
  'steplink-close-due-events',
  '* * * * *',
  'select public.close_due_events_v1()'
);
