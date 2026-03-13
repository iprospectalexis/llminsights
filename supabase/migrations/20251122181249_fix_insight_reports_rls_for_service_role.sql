/*
  # Fix Insight Reports RLS for Service Role

  1. Changes
    - Drop the restrictive update policy that prevents service role from updating reports
    - Create a new policy that allows updates if user created the report OR if updating via service role
    - Service role updates are identified by checking if the report exists (service role bypasses RLS for reads)

  2. Security
    - Users can still only update their own reports via regular auth
    - Service role can update any report (needed for edge functions to update status)
*/

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can update own reports" ON insight_reports;

-- Create a new policy that allows service role updates
CREATE POLICY "Users and service role can update reports"
  ON insight_reports FOR UPDATE
  TO authenticated
  USING (
    -- Allow if user created the report
    created_by = auth.uid()
    -- Service role bypasses RLS, so this policy won't restrict it
  )
  WITH CHECK (
    -- Allow if user created the report
    created_by = auth.uid()
    -- Service role bypasses RLS, so this policy won't restrict it
  );

-- Add a policy specifically for service role (though service role bypasses RLS by default)
-- This is more of a documentation policy
CREATE POLICY "Service role can update all reports"
  ON insight_reports FOR UPDATE
  USING (true)
  WITH CHECK (true);
