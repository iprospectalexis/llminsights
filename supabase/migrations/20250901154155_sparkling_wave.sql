/*
  # Add llm_responses table for storing LLM API responses

  1. New Tables
    - `llm_responses`
      - `id` (uuid, primary key)
      - `audit_id` (uuid, foreign key to audits)
      - `prompt_id` (uuid, foreign key to prompts)
      - `llm` (text, LLM name: searchgpt, perplexity, gemini)
      - `snapshot_id` (text, Brightdata snapshot identifier)
      - `response_url` (text, URL from LLM response)
      - `answer_text` (text, plain text answer)
      - `answer_text_markdown` (text, markdown formatted answer)
      - `answer_html` (text, HTML formatted answer)
      - `response_timestamp` (timestamptz, when LLM generated response)
      - `country` (text, country code for the query)
      - `raw_response_data` (jsonb, full JSON response from Brightdata)
      - `created_at` (timestamptz, record creation time)

  2. Security
    - Enable RLS on `llm_responses` table
    - Add policy for users to access responses via their project ownership

  3. Indexes
    - Performance indexes for common dashboard queries
*/

-- Create the llm_responses table
CREATE TABLE IF NOT EXISTS llm_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL,
  llm text NOT NULL CHECK (llm = ANY (ARRAY['searchgpt'::text, 'perplexity'::text, 'gemini'::text])),
  snapshot_id text,
  response_url text,
  answer_text text,
  answer_text_markdown text,
  answer_html text,
  response_timestamp timestamptz,
  country text DEFAULT 'US',
  raw_response_data jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_llm_responses_audit_id ON llm_responses (audit_id);
CREATE INDEX IF NOT EXISTS idx_llm_responses_prompt_id ON llm_responses (prompt_id);
CREATE INDEX IF NOT EXISTS idx_llm_responses_llm ON llm_responses (llm);
CREATE INDEX IF NOT EXISTS idx_llm_responses_snapshot_id ON llm_responses (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_llm_responses_created_at ON llm_responses (created_at);

-- Enable Row Level Security
ALTER TABLE llm_responses ENABLE ROW LEVEL SECURITY;

-- Create policy for users to access LLM responses via their project ownership
CREATE POLICY "llm_responses_access_via_project" ON llm_responses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits
      JOIN projects ON projects.id = audits.project_id
      WHERE audits.id = llm_responses.audit_id
      AND projects.created_by = auth.uid()
    )
  );