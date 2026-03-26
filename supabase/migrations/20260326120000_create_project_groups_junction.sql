-- Create junction table for many-to-many project <-> groups relationship
CREATE TABLE IF NOT EXISTS project_groups (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, group_id)
);

-- Migrate existing group_id data into the junction table
INSERT INTO project_groups (project_id, group_id)
SELECT id, group_id FROM projects
WHERE group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE project_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "project_groups_select"
  ON project_groups FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_groups.project_id)
  );

-- Simple permissive policies: any authenticated user who can see the project
-- can manage its group assignments (project-level RLS already controls access)
CREATE POLICY "project_groups_insert"
  ON project_groups FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_groups.project_id)
  );

CREATE POLICY "project_groups_delete"
  ON project_groups FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_groups.project_id)
  );
