-- Trial countdown: default on when a trial end is set (banner was hidden because column defaulted false).
--
-- The UPDATE must bypass trg_guard_tenants_privileged: that trigger only allows trial edits for
-- service_role JWT or solution_owner (auth.uid()). Migrations / SQL editor run as postgres with
-- no JWT, so the trigger would raise "Only solution owner may change trial settings".

ALTER TABLE tenants DISABLE TRIGGER trg_guard_tenants_privileged;

UPDATE tenants
SET trial_countdown_enabled = true
WHERE trial_ends_at IS NOT NULL
  AND trial_status = 'active';

ALTER TABLE tenants ENABLE TRIGGER trg_guard_tenants_privileged;

ALTER TABLE tenants
  ALTER COLUMN trial_countdown_enabled SET DEFAULT true;

COMMENT ON COLUMN tenants.trial_countdown_enabled IS 'When true (default for new rows), staff UI shows countdown if trial_ends_at is in the future. Set false to hide the strip.';
