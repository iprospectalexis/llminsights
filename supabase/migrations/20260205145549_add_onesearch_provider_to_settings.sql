/*
  # Add OneSearch provider configuration to settings
  
  1. Changes
    - Add `provider_config` jsonb column to `llm_data_provider_settings` table
    - This will store OneSearch-specific settings like provider choice (brightdata or serp)
  
  2. Default Values
    - Set default provider to 'brightdata' for existing OneSearch configurations
  
  3. Notes
    - The provider_config column is flexible for future additional settings
    - For OneSearch: { "provider": "brightdata" } or { "provider": "serp" }
*/

-- Add provider_config column to store OneSearch provider and other settings
ALTER TABLE llm_data_provider_settings
ADD COLUMN IF NOT EXISTS provider_config jsonb DEFAULT '{}'::jsonb;

-- Set default provider to 'brightdata' for existing OneSearch SERP API configurations
UPDATE llm_data_provider_settings
SET provider_config = jsonb_build_object('provider', 'brightdata')
WHERE data_provider = 'OneSearch SERP API'
AND (provider_config IS NULL OR provider_config::text = '{}');
