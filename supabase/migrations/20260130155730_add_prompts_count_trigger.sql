/*
  # Add Trigger to Update Prompt Count in Project Metrics

  ## Problem
  The `total_prompts` field in `project_metrics` table is not updated when prompts are added, 
  deleted, or modified. This causes the prompt count to always show as 0 on the Projects page.

  ## Solution
  1. Create a function to update `total_prompts` in `project_metrics`
  2. Add triggers on the `prompts` table for INSERT, DELETE operations
  3. Recalculate `total_prompts` for all existing projects

  ## Changes
  - Function: `update_project_prompts_count()` - Updates total_prompts for a project
  - Trigger: `after_prompt_insert` - Updates count when prompts are added
  - Trigger: `after_prompt_delete` - Updates count when prompts are removed
  - Data migration: Recalculate counts for existing projects
*/

-- Function to update the total_prompts count for a project
CREATE OR REPLACE FUNCTION update_project_prompts_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_count integer;
BEGIN
  -- Determine which project_id to update
  IF (TG_OP = 'DELETE') THEN
    v_project_id := OLD.project_id;
  ELSE
    v_project_id := NEW.project_id;
  END IF;

  -- Count the total prompts for this project
  SELECT COUNT(*) INTO v_count
  FROM prompts
  WHERE project_id = v_project_id;

  -- Update or insert the metrics
  INSERT INTO project_metrics (project_id, total_prompts, updated_at)
  VALUES (v_project_id, v_count, now())
  ON CONFLICT (project_id) 
  DO UPDATE SET 
    total_prompts = v_count,
    updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger after inserting prompts
DROP TRIGGER IF EXISTS after_prompt_insert ON prompts;
CREATE TRIGGER after_prompt_insert
  AFTER INSERT ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_project_prompts_count();

-- Trigger after deleting prompts
DROP TRIGGER IF EXISTS after_prompt_delete ON prompts;
CREATE TRIGGER after_prompt_delete
  AFTER DELETE ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_project_prompts_count();

-- Recalculate total_prompts for all existing projects
INSERT INTO project_metrics (project_id, total_prompts, updated_at)
SELECT 
  p.id,
  COALESCE(COUNT(pr.id), 0),
  now()
FROM projects p
LEFT JOIN prompts pr ON pr.project_id = p.id
GROUP BY p.id
ON CONFLICT (project_id) 
DO UPDATE SET 
  total_prompts = EXCLUDED.total_prompts,
  updated_at = EXCLUDED.updated_at;
