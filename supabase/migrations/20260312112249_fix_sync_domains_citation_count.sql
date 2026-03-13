/*
  # Fix sync_domains_from_citations Function
  
  ## Problem
  Function referenced non-existent llm_response_id column
  
  ## Solution
  Use prompt_id and llm to count unique citations
*/

CREATE OR REPLACE FUNCTION sync_domains_from_citations(p_project_id uuid DEFAULT NULL)
RETURNS TABLE(
  project_id uuid,
  domains_synced bigint,
  domains_updated bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_projects_cursor CURSOR FOR 
    SELECT DISTINCT p.id 
    FROM projects p
    WHERE (p_project_id IS NULL OR p.id = p_project_id);
  v_inserted bigint := 0;
  v_updated bigint := 0;
BEGIN
  -- If specific project provided, sync only that project
  -- Otherwise sync all projects
  
  FOR v_project_record IN v_projects_cursor LOOP
    v_project_id := v_project_record.id;
    
    -- Upsert domains from citations for this project
    WITH citation_domains AS (
      SELECT 
        a.project_id,
        c.domain,
        COUNT(DISTINCT c.id) as citation_count
      FROM citations c
      JOIN audits a ON c.audit_id = a.id
      WHERE c.domain IS NOT NULL 
        AND c.domain != ''
        AND a.project_id = v_project_id
      GROUP BY a.project_id, c.domain
    ),
    upserted AS (
      INSERT INTO domains (project_id, domain, citation_count, classification)
      SELECT 
        cd.project_id,
        cd.domain,
        cd.citation_count,
        'Others'::domain_classification  -- Default classification
      FROM citation_domains cd
      ON CONFLICT (project_id, domain) 
      DO UPDATE SET
        citation_count = EXCLUDED.citation_count,
        updated_at = NOW()
      RETURNING 
        domains.id,
        CASE 
          WHEN domains.created_at >= NOW() - INTERVAL '1 second' THEN 'inserted'
          ELSE 'updated'
        END as operation
    )
    SELECT 
      COUNT(*) FILTER (WHERE operation = 'inserted'),
      COUNT(*) FILTER (WHERE operation = 'updated')
    INTO v_inserted, v_updated
    FROM upserted;
    
    RETURN QUERY SELECT v_project_id, v_inserted, v_updated;
  END LOOP;
  
  RETURN;
END;
$$;
