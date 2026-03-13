/*
  # Create Insight Reports Table

  1. New Tables
    - `insight_reports`
      - `id` (uuid, primary key)
      - `project_id` (uuid, foreign key to projects)
      - `report_type` (text) - Type of report: 'brand_strengths', 'content_audit', 'offsite_visibility'
      - `target_brand` (text) - Brand name to focus the analysis on
      - `target_llm` (text) - LLM used for analysis
      - `report_language` (text) - Language of the report (e.g., 'en', 'fr', 'es')
      - `status` (text) - Status: 'pending', 'running', 'completed', 'failed'
      - `report_content` (jsonb) - Generated report content
      - `created_by` (uuid, foreign key to users)
      - `created_at` (timestamptz)
      - `completed_at` (timestamptz)

  2. Security
    - Enable RLS on `insight_reports` table
    - Add policies for authenticated users to manage their reports
    - Add policies for project members to view reports
*/

CREATE TABLE IF NOT EXISTS insight_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('brand_strengths', 'content_audit', 'offsite_visibility')),
  target_brand text NOT NULL,
  target_llm text NOT NULL CHECK (target_llm IN ('searchgpt', 'perplexity', 'gemini')),
  report_language text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  report_content jsonb,
  error_message text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE insight_reports ENABLE ROW LEVEL SECURITY;

-- Users can view reports for projects they created
CREATE POLICY "Users can view own project reports"
  ON insight_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = insight_reports.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Users can create reports for projects they created
CREATE POLICY "Users can create reports for own projects"
  ON insight_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = insight_reports.project_id
      AND projects.created_by = auth.uid()
    )
  );

-- Users can update their own reports
CREATE POLICY "Users can update own reports"
  ON insight_reports FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Users can delete their own reports
CREATE POLICY "Users can delete own reports"
  ON insight_reports FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- Project members can view reports
CREATE POLICY "Project members can view reports"
  ON insight_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = insight_reports.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Admins can view all reports
CREATE POLICY "Admins can view all reports"
  ON insight_reports FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS insight_reports_project_id_idx ON insight_reports(project_id);
CREATE INDEX IF NOT EXISTS insight_reports_created_by_idx ON insight_reports(created_by);
CREATE INDEX IF NOT EXISTS insight_reports_status_idx ON insight_reports(status);
