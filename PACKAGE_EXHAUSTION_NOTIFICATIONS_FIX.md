# Package Exhaustion Notifications Table Fix

## Issue
The `package_exhaustion_notifications` table already exists, but code was trying to insert non-existent columns (`tenant_id`, `customer_id`, `is_read`).

## Solution

### 1. Table Already Exists
The table was created in migration `20260130000000_redesign_package_capacity_system.sql` with this schema:

```sql
CREATE TABLE IF NOT EXISTS package_exhaustion_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES package_subscriptions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  notified_at timestamptz DEFAULT now(),
  UNIQUE(subscription_id, service_id)
);
```

### 2. Code Fix Applied
Updated `server/src/routes/bookings.ts` to only insert the fields that exist:
- ✅ `subscription_id` (required)
- ✅ `service_id` (required)
- ❌ Removed: `tenant_id` (doesn't exist)
- ❌ Removed: `customer_id` (doesn't exist)
- ❌ Removed: `is_read` (doesn't exist)
- ❌ Removed: `notified_at` (has DEFAULT, not needed)

### 3. If You Need to Recreate the Table
If you need to drop and recreate it (not recommended if data exists), use:

```sql
-- Drop table if exists (WARNING: This deletes all data!)
DROP TABLE IF EXISTS package_exhaustion_notifications CASCADE;

-- Recreate with correct schema
CREATE TABLE package_exhaustion_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES package_subscriptions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  notified_at timestamptz DEFAULT now(),
  UNIQUE(subscription_id, service_id)
);

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_package_exhaustion_notifications_subscription 
  ON package_exhaustion_notifications(subscription_id, service_id);

-- Re-enable RLS
ALTER TABLE package_exhaustion_notifications ENABLE ROW LEVEL SECURITY;
```

### 4. If You Need to Add Missing Columns
If you actually need `tenant_id`, `customer_id`, or `is_read` columns, create a migration:

```sql
-- Add tenant_id (if needed)
ALTER TABLE package_exhaustion_notifications 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

-- Add customer_id (if needed)
ALTER TABLE package_exhaustion_notifications 
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE CASCADE;

-- Add is_read (if needed)
ALTER TABLE package_exhaustion_notifications 
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false NOT NULL;
```

**Note:** The current implementation doesn't need these columns because:
- `tenant_id` and `customer_id` can be retrieved via JOIN with `package_subscriptions`
- `is_read` is not currently used in the notification system

## Status
✅ **FIXED** - Code now only inserts fields that exist in the table schema.
