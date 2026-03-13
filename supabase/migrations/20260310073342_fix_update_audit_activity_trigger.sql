/*
  # Fix update_audit_activity trigger to handle NULL audit_id
  
  1. Changes
    - Update `update_audit_activity()` function to check for NULL audit_id before updating
    - This prevents the "record has no field" error when audit_id is NULL
  
  2. Security
    - Maintains SECURITY DEFINER for proper permissions
*/

CREATE OR REPLACE FUNCTION public.update_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only update if audit_id is not NULL
  IF NEW.audit_id IS NOT NULL THEN
    UPDATE audits
    SET last_activity_at = now()
    WHERE id = NEW.audit_id;
  END IF;

  RETURN NEW;
END;
$function$;
