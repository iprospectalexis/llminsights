/*
  # Fix Remaining Statement-Level Triggers Using NEW

  This migration fixes statement-level triggers on `audits` and `citations` tables
  that are incorrectly using the old `queue_audit_metrics_refresh` function which
  references NEW/OLD directly instead of using transition tables.

  ## Changes
  
  1. Drop old triggers on audits and citations tables
  2. Create new statement-level compatible functions for each table
  3. Recreate triggers with proper transition table references
  4. Clean up old unused function

  ## Tables Modified
  - audits (trigger: queue_metrics_refresh_on_audit_complete)
  - citations (triggers: queue_metrics_refresh_on_citation_*)
*/

-- Drop existing problematic triggers
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_audit_complete ON audits;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_update ON citations;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_delete ON citations;

-- Create statement-level function for audits table
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_for_audits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT id, now()
  FROM new_table
  WHERE id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Create statement-level function for citations table (INSERT/UPDATE)
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_for_citations_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM new_table
  WHERE audit_id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Create statement-level function for citations table (DELETE)
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_for_citations_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM old_table
  WHERE audit_id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Recreate triggers for audits table
CREATE TRIGGER queue_metrics_refresh_on_audit_complete
  AFTER UPDATE ON audits
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_for_audits();

-- Recreate triggers for citations table
CREATE TRIGGER queue_metrics_refresh_on_citation_insert
  AFTER INSERT ON citations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_for_citations_insert();

CREATE TRIGGER queue_metrics_refresh_on_citation_update
  AFTER UPDATE ON citations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_for_citations_insert();

CREATE TRIGGER queue_metrics_refresh_on_citation_delete
  AFTER DELETE ON citations
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_for_citations_delete();

-- Note: We keep the old queue_audit_metrics_refresh function for now
-- as it might be used elsewhere, but it's no longer attached to statement-level triggers
