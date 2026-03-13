/*
  # Add New LLM Providers
  
  1. Updates
    - Add new LLM names to the valid_llm_name constraint:
      - Google AI Overview
      - Google AI Mode
      - Bing Copilot
      - Grok
    
  2. Initial Data
    - Insert default settings for all new LLMs with BrightData provider
  
  3. Notes
    - Drops the existing constraint and recreates it with all LLMs
    - Uses ON CONFLICT to avoid errors if LLMs already exist
*/

-- Drop the existing constraint
ALTER TABLE llm_data_provider_settings
  DROP CONSTRAINT IF EXISTS valid_llm_name;

-- Add new constraint with all LLM names including new ones
ALTER TABLE llm_data_provider_settings
  ADD CONSTRAINT valid_llm_name 
  CHECK (llm_name IN (
    'SearchGPT', 
    'Perplexity', 
    'Gemini',
    'Google AI Overview',
    'Google AI Mode',
    'Bing Copilot',
    'Grok'
  ));

-- Insert default settings for new LLMs
INSERT INTO llm_data_provider_settings (llm_name, data_provider)
VALUES 
  ('Google AI Overview', 'BrightData'),
  ('Google AI Mode', 'BrightData'),
  ('Bing Copilot', 'BrightData'),
  ('Grok', 'BrightData')
ON CONFLICT (llm_name) DO NOTHING;
