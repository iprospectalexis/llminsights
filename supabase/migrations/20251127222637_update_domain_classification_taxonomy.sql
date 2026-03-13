/*
  # Update domain classification taxonomy

  1. Changes
    - Drop existing domain_classification enum
    - Create new domain_classification enum with updated categories:
      * Brand: Official company or product websites
      * News/Media: Established publications and online magazines
      * Government/NGO: Public sector or nonprofit sources
      * Social Media: Mentions from platforms like X, LinkedIn, etc
      * UGC: User-driven discussion platforms (Reddit, Forums)
      * Academic: Academic or university domains
      * Encyclopedia: Informational reference sources like Wikipedia
      * Video: Platforms hosting video content (YouTube, etc)
      * Blogs/Personal: Independent bloggers, reviewers, niche creators
      * Competitor: Other brands/businesses in your vertical
      * Others: Miscellaneous sites

  2. Migration Strategy
    - Temporarily change domains.classification to text
    - Drop old enum
    - Create new enum
    - Convert text back to new enum
    - Map old values to new values where applicable

  3. Value Mapping
    - Competitor -> Competitor (unchanged)
    - Video -> Video (unchanged)
    - UGC -> UGC (unchanged)
    - News -> News/Media
    - Blog/Personal -> Blogs/Personal
    - Encyclopedia -> Encyclopedia (unchanged)
    - Government/NGO -> Government/NGO (unchanged)
    - Social Media -> Social Media (unchanged)
    - Others -> Others (unchanged)
*/

-- Step 1: Add temporary text column
ALTER TABLE domains ADD COLUMN classification_temp text;

-- Step 2: Copy existing values to temp column
UPDATE domains SET classification_temp = classification::text;

-- Step 3: Drop the constraint on the original column
ALTER TABLE domains ALTER COLUMN classification DROP DEFAULT;
ALTER TABLE domains DROP COLUMN classification;

-- Step 4: Drop old enum type
DROP TYPE IF EXISTS domain_classification;

-- Step 5: Create new enum type with updated taxonomy
CREATE TYPE domain_classification AS ENUM (
  'Brand',
  'News/Media',
  'Government/NGO',
  'Social Media',
  'UGC',
  'Academic',
  'Encyclopedia',
  'Video',
  'Blogs/Personal',
  'Competitor',
  'Others'
);

-- Step 6: Add column back with new enum type
ALTER TABLE domains ADD COLUMN classification domain_classification DEFAULT 'Others';

-- Step 7: Map old values to new values
UPDATE domains SET classification = 
  CASE classification_temp
    WHEN 'Competitor' THEN 'Competitor'::domain_classification
    WHEN 'Video' THEN 'Video'::domain_classification
    WHEN 'UGC' THEN 'UGC'::domain_classification
    WHEN 'News' THEN 'News/Media'::domain_classification
    WHEN 'Blog/Personal' THEN 'Blogs/Personal'::domain_classification
    WHEN 'Encyclopedia' THEN 'Encyclopedia'::domain_classification
    WHEN 'Government/NGO' THEN 'Government/NGO'::domain_classification
    WHEN 'Social Media' THEN 'Social Media'::domain_classification
    ELSE 'Others'::domain_classification
  END;

-- Step 8: Drop temporary column
ALTER TABLE domains DROP COLUMN classification_temp;