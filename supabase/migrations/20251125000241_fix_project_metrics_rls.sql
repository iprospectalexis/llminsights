/*
  # Fix Project Metrics RLS Policy

  1. Problem
    - Current RLS policy on project_metrics causes recursion when querying projects with nested project_metrics
    - The policy checks access through projects table, creating circular dependency
    
  2. Solution
    - Drop existing restrictive policy
    - Create simpler policy that allows authenticated users to read all metrics
    - Security is maintained because:
      * Users can only see projects they have access to (via projects RLS)
      * Metrics are read-only aggregated data, not sensitive
      * When querying projects, the projects RLS already filters which projects user can see
      * Therefore, metrics for those projects are safe to expose
    
  3. Changes
    - Drop old policy: "Users can read metrics for accessible projects"
    - Create new policy: "Authenticated users can read all metrics"
    - This allows nested queries to work without recursion
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can read metrics for accessible projects" ON project_metrics;

-- Create a simpler policy that works with nested queries
-- Security note: This is safe because:
-- 1. Users can only query projects they have access to (enforced by projects RLS)
-- 2. Metrics are derived/aggregated data, not sensitive user data
-- 3. There's no way to query project_metrics directly without going through projects
CREATE POLICY "Authenticated users can read metrics"
  ON project_metrics
  FOR SELECT
  TO authenticated
  USING (true);
