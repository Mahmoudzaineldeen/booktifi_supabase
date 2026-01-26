# Database Migration Summary

## Latest Migrations (January 31, 2026)

### 1. `20260131000000_add_partial_package_coverage.sql`
**Status:** ✅ Ready
**Purpose:** Adds partial package coverage support
**Changes:**
- Adds `package_covered_quantity` column to `bookings` table
- Adds `paid_quantity` column to `bookings` table
- Adds constraints and indexes

### 2. `20260131000001_update_booking_function_partial_coverage.sql`
**Status:** ✅ Ready
**Purpose:** Updates booking creation function for partial coverage
**Changes:**
- Updates `create_booking_with_lock` function to accept `p_package_covered_quantity` and `p_paid_quantity`
- Validates partial coverage logic
- Stores coverage values in booking records

### 3. `20260131000002_update_package_deduction_trigger.sql`
**Status:** ✅ Ready
**Purpose:** Updates package capacity deduction trigger
**Changes:**
- Updates `decrement_package_usage_on_booking()` trigger function
- Only deducts `package_covered_quantity` instead of full visitor_count
- Handles exhaustion notifications correctly

### 4. `20260131000003_update_bulk_booking_partial_coverage.sql`
**Status:** ✅ Ready
**Purpose:** Updates bulk booking function for partial coverage
**Changes:**
- Updates `create_bulk_booking` function to support partial coverage
- Distributes package coverage across slots
- Handles per-slot coverage calculation

### 5. `20260131000004_enable_subscription_cancellation.sql`
**Status:** ✅ Ready (Fixed - removed invalid `service_provider` role)
**Purpose:** Enables subscription cancellation for admin roles
**Changes:**
- Updates RLS policy to allow `admin_user`, `customer_admin`, `tenant_admin`, and `receptionist` to update subscriptions
- Enables cancellation functionality

## Migration Order

These migrations should be applied in this order:
1. `20260131000000_add_partial_package_coverage.sql` (adds columns)
2. `20260131000001_update_booking_function_partial_coverage.sql` (uses new columns)
3. `20260131000002_update_package_deduction_trigger.sql` (uses new columns)
4. `20260131000003_update_bulk_booking_partial_coverage.sql` (uses new columns)
5. `20260131000004_enable_subscription_cancellation.sql` (independent)

## Dependencies

- All migrations depend on:
  - `package_subscriptions` table
  - `package_subscription_usage` table
  - `bookings` table
  - `user_role` enum (with `admin_user` and `customer_admin` values)

## Verification Checklist

- [x] All migrations have proper syntax
- [x] No invalid enum values (removed `service_provider`)
- [x] All dependencies are in place
- [x] Migration order is correct
- [x] Backward compatibility maintained

## To Apply Migrations

If using Supabase CLI:
```bash
supabase db push
```

Or apply manually in order:
1. Run each migration file in sequence
2. Verify no errors occur
3. Check that columns and functions are created correctly

## Verification

After applying migrations, run the verification script:
```sql
-- Run: supabase/migrations/20260131000005_verify_database_state.sql
```

This will check:
- ✅ `package_covered_quantity` and `paid_quantity` columns exist
- ✅ `create_booking_with_lock` function has partial coverage parameters
- ✅ `create_bulk_booking` function has partial coverage parameters
- ✅ `decrement_package_usage_on_booking` trigger uses `package_covered_quantity`
- ✅ RLS policy allows `admin_user` and `customer_admin` to update subscriptions
