# 🐛 BUG REPORT: Function `resolveCustomerServiceCapacity` Not Found

## Test Failure Details

**Test:** Phase 2 - Capacity Resolution Engine (Tests 2.1, 2.5)  
**Error Code:** PGRST202  
**Error Message:** `Could not find the function public.resolveCustomerServiceCapacity(p_customer_id, p_service_id) in the schema cache`

**Error Hint:** `Perhaps you meant to call the function public.resolvecustomerservicecapacity`

## Root Cause Analysis

The function `resolveCustomerServiceCapacity` is defined in migration:
- `supabase/migrations/20260130000000_redesign_package_capacity_system.sql` (line 57)

However, PostgREST cannot find it in the schema cache. Possible causes:

1. **Migration Not Applied:** The migration may not have been run on this database
2. **Schema Cache Stale:** PostgREST schema cache needs refresh
3. **Case Sensitivity:** PostgreSQL function names are case-sensitive when quoted, but PostgREST may be looking for lowercase

## Verification Steps

### Step 1: Check if Migration Was Applied

```sql
-- Check migration history
SELECT * FROM supabase_migrations.schema_migrations 
WHERE name LIKE '%redesign_package_capacity%'
ORDER BY version DESC;
```

### Step 2: Verify Function Exists in Database

```sql
-- Check if function exists
SELECT 
  proname as function_name,
  pg_get_function_identity_arguments(oid) as arguments,
  pronamespace::regnamespace as schema
FROM pg_proc
WHERE proname ILIKE '%resolvecustomerservicecapacity%';
```

### Step 3: Check PostgREST Schema Cache

PostgREST may need schema refresh. Check Supabase dashboard:
- Database → Functions → Should list `resolveCustomerServiceCapacity`

## Fix Required

**If migration not applied:**
```bash
supabase migration up
# or
supabase db reset
```

**If function exists but PostgREST can't find it:**
1. Refresh PostgREST schema cache (restart Supabase or refresh in dashboard)
2. Verify function is in `public` schema
3. Check function permissions (should be executable by authenticated users)

**If case sensitivity issue:**
The migration creates: `resolveCustomerServiceCapacity`  
PostgREST might expect: `resolvecustomerservicecapacity`

**Solution:** Ensure function is created with exact case, or update migration to use lowercase.

## Impact

- ❌ Capacity resolution cannot work
- ❌ Package bookings will fail
- ❌ Backend booking creation will error when checking capacity

## Priority

**CRITICAL** - System cannot function without this function.

## Test Evidence

```
❌ FAIL: 2.1: Customer with no packages → returns 0 capacity
   Error: Could not find the function public.resolveCustomerServiceCapacity(p_customer_id, p_service_id) in the schema cache

❌ FAIL: 2.5: Resolution is fast
   Error: Function resolveCustomerServiceCapacity not found
```
