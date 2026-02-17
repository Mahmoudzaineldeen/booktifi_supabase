-- Add is_active to branches for deactivate (soft-disable) without deleting
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_branches_is_active ON branches(is_active) WHERE is_active = true;
COMMENT ON COLUMN branches.is_active IS 'When false, branch is deactivated and should be hidden from selection.';
