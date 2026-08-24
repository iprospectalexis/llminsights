-- Fix: missing manager/admin bypass on response_brand_sentiment and
-- sentiment_cache RLS.
--
-- The original Sentiment V2 migration (20260407120000_sentiment_v2.sql) only
-- added project-scoped policies: "project creator OR project_members". Every
-- other project-scoped table in this codebase (audits, llm_responses, brands,
-- citations, …) also has a permissive "managers_access_all_*" policy that
-- lets any admin/manager read regardless of project membership. That policy
-- was copy-pasted everywhere — except on the two sentiment tables — so the
-- Sentiment tab shows "No sentiment data yet" for every manager who isn't
-- the literal `created_by` of the project (e.g. TIPTOE was created by
-- frederique.goubert → no one else sees its 47 rbs rows, even though they
-- can see the audits and llm_responses fine).
--
-- Fix: add the same bypass policy, mirroring the expression used by
-- `managers_access_all_audits` and `managers_access_all_llm_responses`.

CREATE POLICY managers_access_all_brand_sentiment ON response_brand_sentiment
  FOR ALL TO authenticated
  USING (
    ((auth.jwt() ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
    OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
  )
  WITH CHECK (
    ((auth.jwt() ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
    OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
  );

CREATE POLICY managers_access_all_sentiment_cache ON sentiment_cache
  FOR ALL TO authenticated
  USING (
    ((auth.jwt() ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
    OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
  )
  WITH CHECK (
    ((auth.jwt() ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
    OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'manager'::text]))
  );
