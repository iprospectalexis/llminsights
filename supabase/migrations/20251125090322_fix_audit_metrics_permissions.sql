/*
  # Fix Audit Metrics View Permissions

  ## Problem
  The audit_metrics_mv materialized view may not be accessible to authenticated users
  because materialized views don't support RLS directly.

  ## Solution
  - Grant proper SELECT permissions to authenticated role
  - Ensure the view is accessible through direct queries

  ## Changes
  - GRANT SELECT on audit_metrics_mv to authenticated users
  - GRANT SELECT on audit_metrics_mv to anon users (for edge function access)
*/

-- Ensure authenticated users can read from the materialized view
GRANT SELECT ON audit_metrics_mv TO authenticated;
GRANT SELECT ON audit_metrics_mv TO anon;

-- Grant usage on the schema if needed
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
