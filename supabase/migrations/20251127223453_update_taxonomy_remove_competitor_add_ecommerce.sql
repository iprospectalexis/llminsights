/*
  # Update domain classification taxonomy - Remove Competitor, Add Ecommerce

  1. Changes
    - Remove "Competitor" category
    - Add "Brand/Corporate" and "Ecommerce" categories
    - Update "Brand" to "Brand/Corporate"
    - New taxonomy (11 categories):
      * Brand/Corporate: Official company or product website
      * Ecommerce: Ecommerce website
      * News/Media: Publishers, news portals and online magazines
      * Government/NGO: Public sector or nonprofit sources
      * Social Media: Mentions from platforms like X, LinkedIn, or others
      * UGC: User-driven discussion platforms (Reddit, Forums)
      * Academic: Academic or university domains
      * Encyclopedia: Informational reference sources such as Wikipedia
      * Video: Platforms hosting video content (YouTube)
      * Blogs/Personal: Independent bloggers, reviewers, niche content creators
      * Others: Miscellaneous sites

  2. Migration Strategy
    - Convert existing domains to text
    - Drop old enum
    - Create new enum
    - Map old values to new values
    - Brand -> Brand/Corporate
    - Competitor -> Brand/Corporate (competitors are also brands)

  3. Note
    - All domains previously marked as "Competitor" will become "Brand/Corporate"
    - This is appropriate as competitor detection should be handled differently
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
  'Brand/Corporate',
  'Ecommerce',
  'News/Media',
  'Government/NGO',
  'Social Media',
  'UGC',
  'Academic',
  'Encyclopedia',
  'Video',
  'Blogs/Personal',
  'Others'
);

-- Step 6: Add column back with new enum type
ALTER TABLE domains ADD COLUMN classification domain_classification DEFAULT 'Others';

-- Step 7: Map old values to new values
UPDATE domains SET classification = 
  CASE classification_temp
    WHEN 'Brand' THEN 'Brand/Corporate'::domain_classification
    WHEN 'Competitor' THEN 'Brand/Corporate'::domain_classification
    WHEN 'Ecommerce' THEN 'Ecommerce'::domain_classification
    WHEN 'News/Media' THEN 'News/Media'::domain_classification
    WHEN 'Government/NGO' THEN 'Government/NGO'::domain_classification
    WHEN 'Social Media' THEN 'Social Media'::domain_classification
    WHEN 'UGC' THEN 'UGC'::domain_classification
    WHEN 'Academic' THEN 'Academic'::domain_classification
    WHEN 'Encyclopedia' THEN 'Encyclopedia'::domain_classification
    WHEN 'Video' THEN 'Video'::domain_classification
    WHEN 'Blogs/Personal' THEN 'Blogs/Personal'::domain_classification
    ELSE 'Others'::domain_classification
  END;

-- Step 8: Drop temporary column
ALTER TABLE domains DROP COLUMN classification_temp;