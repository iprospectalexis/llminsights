-- Fix: Managers/Admins blocked from running audits (can_run_audits = false)
--
-- Root cause: `can_run_audits` (added 2026-01-29) defaults to false, and its
-- one-time backfill only granted the managers/admins that existed then. Every
-- manager/admin created since is born blocked:
--   1. create-user (edge fn) creates the auth user; a trigger auto-inserts the
--      public.users row with the default role ('client') and no can_run_audits,
--      so the column DEFAULT false applies.
--   2. create-user then UPSERTs role='manager' — an UPDATE that sets role but
--      NOT can_run_audits. The set_default_can_run_audits trigger was
--      BEFORE INSERT only, so it never ran on this update → the row stayed a
--      manager with can_run_audits=false.
-- The same happens on any client -> manager promotion (no update trigger), and
-- the Run Audit modal trusts the flag over the role.
--
-- Fix: (a) backfill every admin/manager to true, and (b) make the trigger fire
-- on INSERT *and* UPDATE and force admins/managers to true (idempotent), so a
-- promotion or the create-user upsert can never again leave a manager blocked.
-- Clients keep their explicit value (default false), so the per-client grant
-- toggle still works.

-- (a) Backfill current managers/admins.
UPDATE users
SET can_run_audits = true
WHERE role IN ('admin', 'manager')
  AND can_run_audits IS DISTINCT FROM true;

-- (b) Recurrence guard.
CREATE OR REPLACE FUNCTION set_default_can_run_audits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('admin', 'manager') THEN
    NEW.can_run_audits := true;
  ELSIF NEW.can_run_audits IS NULL THEN
    NEW.can_run_audits := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_default_can_run_audits_trigger ON users;
CREATE TRIGGER set_default_can_run_audits_trigger
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_default_can_run_audits();
