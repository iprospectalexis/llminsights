/*
  # Configure System Settings from Environment

  1. Purpose
    - Update system settings with actual Supabase URL from the database environment
    - Use internal URL for faster function calls within Supabase
    - Configure service role key from environment

  2. Changes
    - Update system_settings with actual values
    - Use internal Supabase function URL format

  3. Notes
    - Uses internal URL for better performance
    - Settings can be updated by admins if needed
*/

-- Update system settings with proper Supabase internal URL
-- In Supabase, we can use the internal URL format for better performance
UPDATE system_settings 
SET value = 'http://kong:8000',
    updated_at = now()
WHERE key = 'supabase_url';

-- Note: The service_role_key needs to be set manually via the dashboard or API
-- as we cannot access environment variables directly in migrations for security reasons
-- Users should run this SQL after deployment:
-- UPDATE system_settings SET value = 'your-service-role-key-here' WHERE key = 'service_role_key';

-- Create a function to help admins update the service role key
CREATE OR REPLACE FUNCTION update_service_role_key(new_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow authenticated users with admin role
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;
  
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Must be admin to update service role key';
  END IF;
  
  UPDATE system_settings 
  SET value = new_key, updated_at = now()
  WHERE key = 'service_role_key';
  
  RAISE NOTICE 'Service role key updated successfully';
END;
$$;

-- Add a comment to remind about configuration
COMMENT ON TABLE system_settings IS 'System settings for scheduled jobs. The service_role_key must be configured by an admin after deployment.';
