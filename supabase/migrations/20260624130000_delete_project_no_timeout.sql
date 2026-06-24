-- delete_project: lift statement_timeout via a FUNCTION-LEVEL setting
--
-- The first version (20260624120000) set `statement_timeout = 0` inside the
-- body with SET LOCAL. That had no effect: the timeout timer for the
-- enclosing `SELECT delete_project(...)` call is armed at the role's ~8s
-- BEFORE the body runs, so large projects still aborted with SQLSTATE 57014
-- ("canceling statement due to statement timeout").
--
-- The Supabase-supported way to give a function a different timeout is a
-- function-level SET clause, applied at function entry. Disable the timeout
-- entirely for this function. Still SECURITY INVOKER, so RLS on `projects`
-- continues to govern who may delete — authorization is unchanged.

CREATE OR REPLACE FUNCTION delete_project(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '0'
AS $$
BEGIN
  DELETE FROM projects WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_project(uuid) TO authenticated;
