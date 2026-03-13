/*
  # Create LLM Data Provider Settings Table

  1. New Tables
    - `llm_data_provider_settings`
      - `id` (uuid, primary key)
      - `llm_name` (text, unique) - Name of the LLM (SearchGPT, Perplexity, Gemini)
      - `data_provider` (text) - Selected data provider (BrightData, OneSearch SERP API)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `llm_data_provider_settings` table
    - Add policy for admins to read settings
    - Add policy for admins to update settings
    - Add policy for admins to insert settings

  3. Initial Data
    - Insert default settings for all three LLMs
*/

-- Create the llm_data_provider_settings table
CREATE TABLE IF NOT EXISTS llm_data_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  llm_name text UNIQUE NOT NULL,
  data_provider text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add constraint to ensure valid LLM names
ALTER TABLE llm_data_provider_settings
  ADD CONSTRAINT valid_llm_name 
  CHECK (llm_name IN ('SearchGPT', 'Perplexity', 'Gemini'));

-- Add constraint to ensure valid data providers
ALTER TABLE llm_data_provider_settings
  ADD CONSTRAINT valid_data_provider 
  CHECK (data_provider IN ('BrightData', 'OneSearch SERP API'));

-- Enable RLS
ALTER TABLE llm_data_provider_settings ENABLE ROW LEVEL SECURITY;

-- Policy for admins to read settings
CREATE POLICY "Admins can read LLM data provider settings"
  ON llm_data_provider_settings
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Policy for admins to insert settings
CREATE POLICY "Admins can insert LLM data provider settings"
  ON llm_data_provider_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Policy for admins to update settings
CREATE POLICY "Admins can update LLM data provider settings"
  ON llm_data_provider_settings
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Insert default settings for all LLMs
INSERT INTO llm_data_provider_settings (llm_name, data_provider)
VALUES 
  ('SearchGPT', 'BrightData'),
  ('Perplexity', 'BrightData'),
  ('Gemini', 'BrightData')
ON CONFLICT (llm_name) DO NOTHING;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_llm_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_llm_settings_timestamp ON llm_data_provider_settings;
CREATE TRIGGER update_llm_settings_timestamp
  BEFORE UPDATE ON llm_data_provider_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_llm_settings_updated_at();
