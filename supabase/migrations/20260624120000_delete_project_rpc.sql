-- Robust project deletion — lift the per-statement timeout
--
-- Problem: deleting a project cascades to its audits -> llm_responses /
-- citations / response_brand_sentiment / api_usage_events (tens of thousands
-- of rows on old projects), plus a materialized-view refresh fired by the
-- delete triggers. On large projects the whole cascade exceeds the API
-- role's statement_timeout (~8s), so the client-side `.delete()` aborts with
-- SQLSTATE 57014 and the project can never be removed. The FK chain itself is
-- already fully ON DELETE CASCADE / SET NULL — the only blocker is the clock.
--
-- Fix: run the identical cascade delete from a function that raises
-- statement_timeout for its own transaction. statement_timeout is USERSET, so
-- the `authenticated` role may lift it via SET LOCAL. The function is
-- SECURITY INVOKER (the default): RLS on `projects` still governs WHO may
-- delete, so authorization is unchanged versus the previous client delete —
-- we only remove the time limit. (FK cascade deletes on child tables are
-- referential actions and are not subject to child-table RLS.)

CREATE OR REPLACE FUNCTION delete_project(p_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Scoped to this transaction only; reverts automatically afterwards.
  SET LOCAL statement_timeout = 0;
  DELETE FROM projects WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_project(uuid) TO authenticated;
