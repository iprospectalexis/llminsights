/*
  # Backfill missing domains in citations table

  1. Purpose
    - Ensure all citations have a domain extracted from their page_url
    - Fix historical data where domain might be null or empty
    - Prevent discrepancies between Pages and Domains tables

  2. Changes
    - Update citations with null/empty domains by extracting from page_url
    - Add a check constraint to ensure future citations have domains
*/

-- Update citations that have a page_url but no domain
UPDATE citations
SET domain = REGEXP_REPLACE(
  REGEXP_REPLACE(page_url, '^https?://(www\.)?', ''),
  '/.*$',
  ''
)
WHERE (domain IS NULL OR domain = '')
  AND page_url IS NOT NULL
  AND page_url != '';

-- Add a function to automatically set domain from page_url
CREATE OR REPLACE FUNCTION extract_domain_from_url(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF url IS NULL OR url = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove protocol and www
  url := REGEXP_REPLACE(url, '^https?://(www\.)?', '');
  
  -- Remove path and query string
  url := REGEXP_REPLACE(url, '/.*$', '');
  
  RETURN url;
END;
$$;

-- Create or replace trigger to auto-populate domain
CREATE OR REPLACE FUNCTION set_citation_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If domain is not set but page_url is, extract domain from URL
  IF (NEW.domain IS NULL OR NEW.domain = '') AND NEW.page_url IS NOT NULL AND NEW.page_url != '' THEN
    NEW.domain := extract_domain_from_url(NEW.page_url);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS citations_set_domain ON citations;

-- Create trigger
CREATE TRIGGER citations_set_domain
  BEFORE INSERT OR UPDATE ON citations
  FOR EACH ROW
  EXECUTE FUNCTION set_citation_domain();
