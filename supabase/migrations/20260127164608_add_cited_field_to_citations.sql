/*
  # Add cited field to citations table
  
  1. Changes
    - Add `cited` boolean column to citations table
    - Nullable to handle existing records and missing field cases
    - Default NULL for backward compatibility
    
  2. Purpose
    - Track whether SearchGPT explicitly marked a citation as cited
    - Filter out citations where cited=false from Citation Rate calculations
    - NULL means field was missing (treat as cited for backward compatibility)
    
  3. Security
    - No RLS changes needed - inherits existing policies
*/

-- Add cited field to citations table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'citations' AND column_name = 'cited'
  ) THEN
    ALTER TABLE citations ADD COLUMN cited boolean DEFAULT NULL;
  END IF;
END $$;
