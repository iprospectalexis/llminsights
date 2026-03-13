/*
  # Fix project deletion cascade issue

  1. Problem
    - When a project is deleted, prompts are cascade deleted
    - The after_prompt_delete trigger tries to update project_metrics
    - This fails because the project no longer exists
    
  2. Solution
    - Update the update_project_prompts_count function to check if project exists
    - Only update metrics if the project still exists
    - This prevents the foreign key constraint error during cascade deletion
    
  3. Security
    - Maintains SECURITY DEFINER for proper access
    - No changes to RLS policies
*/

CREATE OR REPLACE FUNCTION update_project_prompts_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_count integer;
  v_project_exists boolean;
BEGIN
  -- Determine which project_id to update
  IF (TG_OP = 'DELETE') THEN
    v_project_id := OLD.project_id;
  ELSE
    v_project_id := NEW.project_id;
  END IF;

  -- Check if the project still exists (it might be in the process of being deleted)
  SELECT EXISTS(SELECT 1 FROM projects WHERE id = v_project_id) INTO v_project_exists;
  
  -- If project doesn't exist, skip the update (cascade deletion in progress)
  IF NOT v_project_exists THEN
    RETURN COALESCE(NEW, OLD);
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
