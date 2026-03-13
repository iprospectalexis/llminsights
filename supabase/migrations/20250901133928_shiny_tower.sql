/*
  # LLM Insights Initial Schema

  1. New Tables
    - `users` - User profile data extending Supabase Auth
    - `groups` - Project organization groups
    - `projects` - Main project entities with domain tracking
    - `project_members` - Project access control
    - `brands` - Brands and competitors per project
    - `prompts` - Prompts organized by groups
    - `audits` - LLM audit runs with progress tracking
    - `audit_steps` - Detailed audit step progress
    - `citations` - Results from LLM queries with sentiment
    - `events` - Audit logs and notifications

  2. Security
    - Enable RLS on all tables
    - Role-based access policies
    - Project membership-based access control

  3. Features
    - Real-time progress tracking
    - Multi-tenant architecture
    - Sentiment analysis support
    - Comprehensive audit logging
*/

-- Users profile table (extends Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text,
  role text CHECK (role IN ('admin', 'manager', 'client')) DEFAULT 'client',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Groups for organizing projects
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  domain text NOT NULL,
  domain_mode text CHECK (domain_mode IN ('exact', 'subdomains')) NOT NULL DEFAULT 'exact',
  country text NOT NULL DEFAULT 'US',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Project members for access control
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('admin', 'manager', 'client')) DEFAULT 'client',
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Brands and competitors
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  is_competitor boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Prompts for LLM queries
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  prompt_text text NOT NULL,
  prompt_group text NOT NULL DEFAULT 'General',
  created_at timestamptz DEFAULT now()
);

-- Audit runs
CREATE TABLE IF NOT EXISTS audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  llms text[] NOT NULL,
  run_by uuid REFERENCES users(id) ON DELETE SET NULL,
  sentiment boolean DEFAULT false,
  status text CHECK (status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Audit step progress
CREATE TABLE IF NOT EXISTS audit_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  step text CHECK (step IN ('fetch', 'parse', 'sentiment', 'persist')) NOT NULL,
  status text CHECK (status IN ('pending', 'running', 'done', 'error')) DEFAULT 'pending',
  message text,
  created_at timestamptz DEFAULT now()
);

-- Citations results
CREATE TABLE IF NOT EXISTS citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL,
  llm text CHECK (llm IN ('searchgpt', 'perplexity', 'gemini')) NOT NULL,
  page_url text,
  domain text,
  citation_text text,
  position integer,
  sentiment_score numeric CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  sentiment_label text CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  checked_at timestamptz DEFAULT now()
);

-- Events for audit logging
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  audit_id uuid REFERENCES audits(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- Admins can read all users
CREATE POLICY "Admins can read all users" ON users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Groups access
CREATE POLICY "Users can read groups" ON groups
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can create groups" ON groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Group creators can update" ON groups
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);

-- Projects access based on membership
CREATE POLICY "Project members can read projects" ON projects
  FOR SELECT TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_members 
      WHERE project_id = projects.id AND user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can create projects" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Project owners can update" ON projects
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_members 
      WHERE project_id = projects.id AND user_id = auth.uid() AND role IN ('admin', 'manager')
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Project members policies
CREATE POLICY "Project members can read memberships" ON project_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM projects 
      WHERE id = project_id AND created_by = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Project owners can manage members" ON project_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE id = project_id AND created_by = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Brands, prompts, audits, and citations inherit project access
CREATE POLICY "Project members can access brands" ON brands
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE id = project_id AND (
        created_by = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
      )
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Project members can access prompts" ON prompts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE id = project_id AND (
        created_by = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
      )
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Project members can access audits" ON audits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE id = project_id AND (
        created_by = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
      )
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Project members can access audit steps" ON audit_steps
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      JOIN projects p ON a.project_id = p.id
      WHERE a.id = audit_id AND (
        p.created_by = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members WHERE project_id = p.id AND user_id = auth.uid())
      )
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Project members can access citations" ON citations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      JOIN projects p ON a.project_id = p.id
      WHERE a.id = audit_id AND (
        p.created_by = auth.uid() OR
        EXISTS (SELECT 1 FROM project_members WHERE project_id = p.id AND user_id = auth.uid())
      )
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can access their events" ON events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_audits_project_id ON audits(project_id);
CREATE INDEX IF NOT EXISTS idx_citations_audit_id ON citations(audit_id);
CREATE INDEX IF NOT EXISTS idx_citations_domain ON citations(domain);
CREATE INDEX IF NOT EXISTS idx_citations_checked_at ON citations(checked_at);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_audit_id ON events(audit_id);

-- Enable realtime for audit tracking
ALTER PUBLICATION supabase_realtime ADD TABLE audits;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_steps;