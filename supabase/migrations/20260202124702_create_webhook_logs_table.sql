/*
  # Create webhook logs table

  1. New Tables
    - `webhook_logs`
      - `id` (uuid, primary key)
      - `webhook_type` (text) - Type of webhook (e.g., 'onesearch')
      - `job_id` (text) - Job ID from the webhook
      - `event` (text) - Event type from payload
      - `status` (text) - Success or error
      - `payload` (jsonb) - Full webhook payload
      - `error_message` (text) - Error message if failed
      - `response_status` (integer) - HTTP response status code
      - `processing_time_ms` (integer) - How long processing took
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `webhook_logs` table
    - Add policies for authenticated users to read logs
    - Service role can insert logs

  3. Indexes
    - Index on job_id for fast lookups
    - Index on created_at for time-based queries
*/

CREATE TABLE IF NOT EXISTS webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_type text NOT NULL DEFAULT 'onesearch',
  job_id text,
  event text,
  status text NOT NULL, -- 'received', 'success', 'error'
  payload jsonb,
  error_message text,
  response_status integer,
  processing_time_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Index for fast job_id lookups
CREATE INDEX IF NOT EXISTS idx_webhook_logs_job_id ON webhook_logs(job_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

-- Policy: Authenticated users can read webhook logs
CREATE POLICY "Authenticated users can read webhook logs"
  ON webhook_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Service role can insert webhook logs (for edge functions)
CREATE POLICY "Service role can insert webhook logs"
  ON webhook_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);
