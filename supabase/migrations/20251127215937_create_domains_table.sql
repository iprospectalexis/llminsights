/*
  # Create domains table for citation source classification

  1. New Tables
    - `domains`
      - `id` (uuid, primary key)
      - `domain` (text, unique per project) - domain name extracted from citations
      - `classification` (enum) - domain category (Competitor, Video, UGC, News, Blog/Personal, Encyclopedia, Government/NGO, Social Media, Others)
      - `project_id` (uuid, foreign key) - link to project
      - `citation_count` (integer, default 0) - number of unique llm_responses citing this domain
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Enums
    - `domain_classification` - possible domain types

  3. Security
    - Enable RLS on `domains` table
    - Policies for project members to read domains
    - Policies for authenticated users to manage their project domains
    - Service role can insert/update for automated classification

  4. Indexes
    - Index on project_id for fast lookups
    - Unique index on (project_id, domain) to prevent duplicates per project
*/

-- Create enum for domain classification
DO $$ BEGIN
  CREATE TYPE domain_classification AS ENUM (
    'Competitor',
    'Video',
    'UGC',
    'News',
    'Blog/Personal',
    'Encyclopedia',
    'Government/NGO',
    'Social Media',
    'Others'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create domains table
CREATE TABLE IF NOT EXISTS domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  classification domain_classification DEFAULT 'Others',
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  citation_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_domain_per_project UNIQUE (project_id, domain)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_domains_project_id ON domains(project_id);
CREATE INDEX IF NOT EXISTS idx_domains_classification ON domains(classification);

-- Enable RLS
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

-- Policy: Project members can view domains
CREATE POLICY "Project members can view domains"
  ON domains
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = domains.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Policy: Service role can insert domains (for automated classification)
CREATE POLICY "Service role can insert domains"
  ON domains
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can update domains
CREATE POLICY "Service role can update domains"
  ON domains
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can insert domains for their projects
CREATE POLICY "Users can insert domains for their projects"
  ON domains
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = domains.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Policy: Authenticated users can update domains for their projects
CREATE POLICY "Users can update domains for their projects"
  ON domains
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = domains.project_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = domains.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_domains_updated_at_trigger ON domains;
CREATE TRIGGER update_domains_updated_at_trigger
  BEFORE UPDATE ON domains
  FOR EACH ROW
  EXECUTE FUNCTION update_domains_updated_at();