# Slot Capacity Reduction Fix

## Problem

When bookings were created, the slot's `available_capacity` was not being decreased, even though `booked_count` might have been updated. This caused:
- Slots showing incorrect availability
- Multiple bookings being allowed for the same slot
- Capacity not reflecting actual bookings

## Root Cause

1. **Trigger Issue**: The `reduce_slot_capacity_on_booking()` trigger only reduced capacity when `NEW.status = 'confirmed'`
2. **Booking Status**: Bookings are created with status `'pending'`, not `'confirmed'`
3. **Result**: Trigger never fired, so capacity was never reduced

## Solution

### 1. Updated Database Trigger (`supabase/migrations/20260123000000_fix_slot_capacity_reduction.sql`)

**Changed**:
- Trigger now reduces capacity for both `'pending'` and `'confirmed'` bookings
- Capacity is reduced immediately when booking is created
- Capacity is restored when booking is cancelled/completed

**Before**:
```sql
IF NEW.status = 'confirmed' THEN
  -- Reduce capacity
END IF;
```

**After**:
```sql
IF NEW.status IN ('pending', 'confirmed') THEN
  -- Reduce capacity
END IF;
```

### 2. Added Manual Update in RPC Function (`database/create_booking_with_lock_function.sql`)

**Added**:
- Direct capacity update in `create_booking_with_lock()` function
- Acts as backup in case trigger doesn't fire
- Ensures capacity is always reduced when booking is created

**Code**:
```sql
-- CRITICAL FIX: Reduce slot capacity immediately when booking is created
UPDATE slots
SET 
  available_capacity = GREATEST(0, available_capacity - p_visitor_count),
  booked_count = booked_count + p_visitor_count
WHERE id = p_slot_id;
```

## How It Works Now

### When Booking is Created

1. **Booking Inserted**: Status = `'pending'`
2. **Trigger Fires**: `reduce_slot_capacity_on_booking()`
3. **Capacity Reduced**: `available_capacity -= visitor_count`
4. **Booked Count Increased**: `booked_count += visitor_count`
5. **RPC Function**: Also updates capacity directly (backup)

### When Booking Status Changes

1. **Pending → Confirmed**: No change (capacity already reduced)
2. **Confirmed → Cancelled**: Capacity restored
3. **Pending → Cancelled**: Capacity restored
4. **Any → Completed**: Capacity restored (if was confirmed/pending)

## Testing

### Manual Test Steps

1. **Check Current Slot Capacity**:
   ```sql
   SELECT id, available_capacity, booked_count, total_capacity
   FROM slots
   WHERE id = '<slot_id>';
   ```

2. **Create a Booking**:
   - Use receptionist or customer booking flow
   - Create booking for the slot

3. **Verify Capacity Reduced**:
   ```sql
   SELECT id, available_capacity, booked_count, total_capacity
   FROM slots
   WHERE id = '<slot_id>';
   ```
   - `available_capacity` should decrease by `visitor_count`
   - `booked_count` should increase by `visitor_count`

4. **Cancel Booking**:
   - Cancel the booking

5. **Verify Capacity Restored**:
   ```sql
   SELECT id, available_capacity, booked_count, total_capacity
   FROM slots
   WHERE id = '<slot_id>';
   ```
   - `available_capacity` should increase back
   - `booked_count` should decrease

## Fixing Existing Data

If there are existing bookings that didn't reduce capacity, run this script:

```sql
-- Fix existing bookings that didn't reduce capacity
-- This recalculates slot capacity based on actual bookings

UPDATE slots s
SET 
  available_capacity = GREATEST(0, 
    s.original_capacity - COALESCE((
      SELECT SUM(b.visitor_count)
      FROM bookings b
      WHERE b.slot_id = s.id
        AND b.status IN ('pending', 'confirmed')
    ), 0)
  ),
  booked_count = COALESCE((
    SELECT SUM(b.visitor_count)
    FROM bookings b
    WHERE b.slot_id = s.id
      AND b.status IN ('pending', 'confirmed')
  ), 0)
WHERE EXISTS (
  SELECT 1
  FROM bookings b
  WHERE b.slot_id = s.id
    AND b.status IN ('pending', 'confirmed')
);
```

## Files Changed

1. **New Migration**: `supabase/migrations/20260123000000_fix_slot_capacity_reduction.sql`
   - Updates trigger to handle 'pending' status
   - Updates restore function to handle 'pending' status

2. **Updated RPC Function**: `database/create_booking_with_lock_function.sql`
   - Adds manual capacity update as backup

## Deployment

1. **Apply Migration**: Run the new migration in Supabase
2. **Update RPC Function**: Deploy updated `create_booking_with_lock` function
3. **Fix Existing Data**: Run the fix script above if needed
4. **Test**: Create a booking and verify capacity decreases

## Verification

After deployment, verify:
- ✅ New bookings reduce slot capacity immediately
- ✅ Cancelled bookings restore slot capacity
- ✅ Available slots reflect correct capacity
- ✅ Fully booked slots are hidden/disabled
