-- Audit queue with concurrency control
-- Prevents overwhelming BrightData API when multiple audits are triggered simultaneously

-- Create audit queue table
CREATE TABLE IF NOT EXISTS audit_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  llms TEXT[] NOT NULL DEFAULT '{}',
  enable_sentiment BOOLEAN NOT NULL DEFAULT true,
  force_web_search BOOLEAN NOT NULL DEFAULT true,
  group_ids UUID[] DEFAULT '{}',
  is_scheduled BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id)
);

-- Index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_audit_queue_status ON audit_queue(status, created_at);

-- Enable RLS
ALTER TABLE audit_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own queue entries"
  ON audit_queue FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert into queue"
  ON audit_queue FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- Function to process the audit queue
-- Respects a max concurrency limit (default 3 concurrent audits)
CREATE OR REPLACE FUNCTION process_audit_queue(max_concurrent INT DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  running_count INT;
  queue_entry RECORD;
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Count currently running audits
  SELECT COUNT(*) INTO running_count
  FROM audits
  WHERE status = 'running';

  IF running_count >= max_concurrent THEN
    RAISE NOTICE 'process_audit_queue: % audits running (max %), skipping', running_count, max_concurrent;
    RETURN;
  END IF;

  -- Get Supabase config
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.supabase_service_role_key', true);

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'process_audit_queue: Missing supabase_url or service_role_key settings';
    RETURN;
  END IF;

  -- Pick next queued entry (FIFO)
  FOR queue_entry IN
    SELECT * FROM audit_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT (max_concurrent - running_count)
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Mark as processing
    UPDATE audit_queue
    SET status = 'processing', started_at = NOW()
    WHERE id = queue_entry.id;

    -- Call run-audit edge function
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/run-audit',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'projectId', queue_entry.project_id,
        'llms', queue_entry.llms,
        'enableSentiment', queue_entry.enable_sentiment,
        'forceWebSearch', queue_entry.force_web_search,
        'isScheduled', queue_entry.is_scheduled
      ),
      timeout_milliseconds := 60000
    );

    RAISE NOTICE 'process_audit_queue: Started audit for project %', queue_entry.project_id;
  END LOOP;
END;
$$;

-- Schedule queue processing every 30 seconds (two staggered 1-min crons)
SELECT cron.schedule(
  'process-audit-queue-a',
  '* * * * *',
  $$SELECT process_audit_queue(3);$$
);

SELECT cron.schedule(
  'process-audit-queue-b',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT process_audit_queue(3);$$
);
