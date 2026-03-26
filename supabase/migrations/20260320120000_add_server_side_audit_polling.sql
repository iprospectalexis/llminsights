-- Server-side audit polling
-- Removes dependency on browser tab staying open for audit completion
-- Polls all running audits every 30 seconds via pg_cron + pg_net

-- Create function that polls all running audits
CREATE OR REPLACE FUNCTION poll_running_audits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  audit_record RECORD;
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Get Supabase config
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.supabase_service_role_key', true);

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'poll_running_audits: Missing supabase_url or service_role_key settings';
    RETURN;
  END IF;

  -- Find all running audits
  FOR audit_record IN
    SELECT id FROM audits
    WHERE status = 'running'
    ORDER BY started_at ASC
  LOOP
    -- Call poll-audit-results edge function for each running audit
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/poll-audit-results',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object('auditId', audit_record.id),
      timeout_milliseconds := 55000
    );

    RAISE NOTICE 'poll_running_audits: Triggered poll for audit %', audit_record.id;
  END LOOP;
END;
$$;

-- Schedule polling every 30 seconds
-- pg_cron minimum interval is 1 minute, so we use two staggered jobs
SELECT cron.schedule(
  'poll-running-audits-a',
  '* * * * *',
  $$SELECT poll_running_audits();$$
);

-- Second job offset by 30 seconds using pg_sleep
SELECT cron.schedule(
  'poll-running-audits-b',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT poll_running_audits();$$
);
