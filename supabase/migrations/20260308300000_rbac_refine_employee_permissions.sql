-- ============================================================================
-- RBAC: Refine employee permissions to match actual system behavior
-- ============================================================================
-- - Create/Edit booking: descriptions clarify that assigning employee is part of the flow
-- - Issue invoices: renamed to "Update payment status" (invoices are created when payment is recorded)
-- - Sell packages + Create subscriptions: merged into one permission (sell_packages)
-- - Assign employee to booking: removed (assignment is part of create/edit booking)
-- ============================================================================

-- 1. Update permission labels/descriptions (IDs unchanged for compatibility)
UPDATE permissions SET
  name = 'Create booking',
  description = 'Create new bookings (includes assigning employee when applicable)'
WHERE id = 'create_booking';

UPDATE permissions SET
  name = 'Edit booking',
  description = 'Edit existing bookings (includes reassigning employee when applicable)'
WHERE id = 'edit_booking';

UPDATE permissions SET
  name = 'Update payment status',
  description = 'Update booking and subscription payment status (e.g. mark as paid). Invoices are created/sent when payment is recorded.'
WHERE id = 'issue_invoices';

UPDATE permissions SET
  name = 'Sell packages',
  description = 'Sell packages and create package subscriptions for customers'
WHERE id = 'sell_packages';

-- 2. Merge create_subscriptions into sell_packages: ensure roles that had create_subscriptions have sell_packages
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, 'sell_packages'
FROM role_permissions rp
WHERE rp.permission_id = 'create_subscriptions'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions r2
    WHERE r2.role_id = rp.role_id AND r2.permission_id = 'sell_packages'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Remove create_subscriptions from all roles, then drop the permission
DELETE FROM role_permissions WHERE permission_id = 'create_subscriptions';
DELETE FROM permissions WHERE id = 'create_subscriptions';

-- 3. Remove assign_employee_to_booking (assignment is part of create/edit booking)
DELETE FROM role_permissions WHERE permission_id = 'assign_employee_to_booking';
DELETE FROM permissions WHERE id = 'assign_employee_to_booking';

COMMENT ON TABLE permissions IS 'RBAC: Registry of all system permissions (refined 20260308)';
