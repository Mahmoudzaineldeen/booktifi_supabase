# SQL Verification Test - Run in Supabase

This test can be run directly in Supabase SQL Editor without needing API tokens.

## Step 1: Check Triggers Exist

Run this query to verify triggers are active:

```sql
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as is_enabled,
  CASE 
    WHEN tgenabled = 'O' THEN '✅ Enabled'
    WHEN tgenabled = 'D' THEN '❌ Disabled'
    ELSE 'Unknown'
  END as status
FROM pg_trigger
WHERE tgname LIKE '%slot_capacity%'
ORDER BY tgname;
```

**Expected Result**: Should show 2 triggers:
- `trigger_reduce_slot_capacity_on_insert` - ✅ Enabled
- `trigger_manage_slot_capacity_on_update` - ✅ Enabled

## Step 2: Check Functions Exist

```sql
SELECT 
  proname as function_name,
  CASE 
    WHEN proname = 'reduce_slot_capacity_on_booking' THEN '✅ Should exist'
    WHEN proname = 'restore_slot_capacity_on_booking' THEN '✅ Should exist'
    WHEN proname = 'recalculate_all_slot_capacities' THEN '✅ Should exist'
  END as status
FROM pg_proc
WHERE proname IN (
  'reduce_slot_capacity_on_booking',
  'restore_slot_capacity_on_booking',
  'recalculate_all_slot_capacities'
)
ORDER BY proname;
```

**Expected Result**: Should show 3 functions

## Step 3: Find a Test Slot

```sql
SELECT 
  s.id as slot_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.available_capacity,
  s.booked_count,
  s.original_capacity,
  s.is_available,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as active_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as total_booked_visitors
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.is_available = true
  AND s.available_capacity > 0
  AND s.slot_date >= CURRENT_DATE
GROUP BY s.id, s.slot_date, s.start_time, s.end_time, s.available_capacity, s.booked_count, s.original_capacity, s.is_available
ORDER BY s.slot_date, s.start_time
LIMIT 5;
```

**Note**: Pick a slot ID from the results for testing.

## Step 4: Verify Capacity Calculation

Replace `<SLOT_ID>` with an actual slot ID from Step 3:

```sql
SELECT 
  s.id as slot_id,
  s.original_capacity,
  s.available_capacity as current_available,
  s.booked_count as current_booked,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_active_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_booked_visitors,
  s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_available,
  COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_booked,
  CASE 
    WHEN s.available_capacity = (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
      AND s.booked_count = COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
    THEN '✅ CORRECT'
    ELSE '❌ MISMATCH - Run recalculation function'
  END as status
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.id = '<SLOT_ID>'  -- Replace with actual slot ID
GROUP BY s.id, s.original_capacity, s.available_capacity, s.booked_count;
```

**Expected Result**: Status should be `✅ CORRECT`

## Step 5: Run Recalculation Function

This will fix any slots with incorrect capacity:

```sql
SELECT * FROM recalculate_all_slot_capacities()
LIMIT 10;
```

**Expected Result**: Should return a table showing updated slots

## Step 6: Find Slots with Incorrect Capacity

```sql
SELECT 
  s.id,
  s.slot_date,
  s.start_time,
  s.original_capacity,
  s.available_capacity as current_available,
  s.booked_count as current_booked,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_booked_visitors,
  s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_available,
  CASE 
    WHEN s.available_capacity != (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
      OR s.booked_count != COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
    THEN '❌ INCORRECT'
    ELSE '✅ CORRECT'
  END as status
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.is_available = true
GROUP BY s.id, s.slot_date, s.start_time, s.original_capacity, s.available_capacity, s.booked_count
HAVING s.available_capacity != (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
   OR s.booked_count != COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
ORDER BY s.slot_date, s.start_time
LIMIT 20;
```

**Expected Result**: Should return 0 rows (all slots correct) or show slots that need fixing

## Test Results Summary

After running all queries:

- ✅ **Triggers Active**: Both triggers should be enabled
- ✅ **Functions Exist**: All 3 functions should exist
- ✅ **Capacity Correct**: All slots should have correct capacity
- ✅ **Recalculation Works**: Function should update incorrect slots

If any step fails, check:
1. Migration `20260123000002_permanent_slot_capacity_fix.sql` was applied
2. RPC function `create_booking_with_lock` was updated
3. Triggers are enabled (not disabled)
