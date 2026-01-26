# Data Inconsistency Analysis: Booking Service ID Mismatch

## Problem Identified

The test revealed a data inconsistency where:
- **Booking** has `service_id = 74e261c0-b365-4515-a527-dd9ca0386597`
- **Booking's current slot's shift** has `service_id = 5676ba6b-9e03-4743-a6c9-ced451928765` (DIFFERENT!)
- This causes backend validation to fail when trying to change booking time

## Root Cause

### How Data Flows:

1. **Slots are created** with `service_id` from the shift:
   ```sql
   INSERT INTO slots (tenant_id, service_id, shift_id, ...)
   VALUES (v_tenant_id, v_service_id, p_shift_id, ...)
   ```
   - `service_id` comes from `shifts.service_id` when slot is generated

2. **Bookings are created** with `service_id` from the request:
   ```typescript
   // Frontend sends:
   {
     service_id: selectedService.id,  // From user selection
     slot_id: slot.id,
     ...
   }
   ```
   - `service_id` is set directly from the frontend request

3. **Backend validation** checks shift's service_id:
   ```sql
   SELECT s.id, sh.service_id
   FROM slots s
   JOIN shifts sh ON s.shift_id = sh.id
   WHERE s.id = p_new_slot_id
   
   IF v_new_slot_record.service_id != v_booking_record.service_id THEN
     RAISE EXCEPTION 'New slot belongs to a different service';
   END IF;
   ```

### The Problem:

**Scenario 1: Shift Reassignment**
- A shift was originally created for Service A
- Slots were generated for that shift (with `service_id = A`)
- Bookings were created (with `service_id = A`)
- Later, the shift was reassigned to Service B
- Now: `shifts.service_id = B`, but `bookings.service_id = A`
- **Result**: Validation fails because booking's service_id doesn't match shift's service_id

**Scenario 2: Data Migration Issue**
- During a migration or data fix, shifts were reassigned to different services
- Existing bookings were not updated to match
- **Result**: Bookings have old service_id, shifts have new service_id

**Scenario 3: Manual Data Entry Error**
- Someone manually changed a shift's service_id in the database
- Or changed a booking's service_id incorrectly
- **Result**: Mismatch between booking and shift service_ids

## Why This Happens

The system has **two sources of truth** for service_id:
1. **Bookings table**: `bookings.service_id` (set at booking creation)
2. **Shifts table**: `shifts.service_id` (can be changed independently)

When a shift's service_id changes, existing bookings are not automatically updated.

## Impact

- ✅ **Booking creation**: Works fine (uses correct service_id from request)
- ❌ **Booking time change**: Fails validation (booking.service_id ≠ shift.service_id)
- ❌ **Data integrity**: Bookings may reference wrong service

## Solution Options

### Option 1: Fix Existing Data (Recommended)
Create a migration to fix all inconsistent bookings:

```sql
-- Fix bookings where service_id doesn't match their slot's shift's service_id
UPDATE bookings b
SET service_id = sh.service_id
FROM slots s
JOIN shifts sh ON s.shift_id = sh.id
WHERE b.slot_id = s.id
  AND b.service_id != sh.service_id;
```

### Option 2: Update Booking Service ID During Time Change
Modify `edit_booking_time` to update booking's service_id if it doesn't match:

```sql
-- In edit_booking_time function, after validation:
IF v_new_slot_record.service_id != v_booking_record.service_id THEN
  -- Update booking's service_id to match the new slot's shift
  UPDATE bookings
  SET service_id = v_new_slot_record.service_id
  WHERE id = p_booking_id;
END IF;
```

### Option 3: Use Shift's Service ID for Validation Only
Change validation to use the booking's current slot's shift service_id instead:

```sql
-- Get booking's current slot's shift service_id
SELECT sh.service_id INTO v_current_shift_service_id
FROM slots s
JOIN shifts sh ON s.shift_id = sh.id
WHERE s.id = v_booking_record.slot_id;

-- Validate new slot's shift matches current slot's shift
IF v_new_slot_record.service_id != v_current_shift_service_id THEN
  RAISE EXCEPTION 'New slot belongs to a different service';
END IF;
```

## Recommended Approach

**Combine Option 1 + Option 2**:
1. **Fix existing data** with a migration (one-time fix)
2. **Update booking service_id** during time change (prevent future issues)

This ensures:
- ✅ All existing bookings are fixed
- ✅ Future time changes automatically fix service_id
- ✅ Data remains consistent going forward

## Implementation

### Step 1: Create Migration to Fix Existing Data

```sql
-- Migration: Fix booking service_id inconsistencies
-- This updates all bookings where service_id doesn't match their slot's shift's service_id

UPDATE bookings b
SET service_id = sh.service_id,
    updated_at = now()
FROM slots s
JOIN shifts sh ON s.shift_id = sh.id
WHERE b.slot_id = s.id
  AND b.service_id != sh.service_id
  AND b.status NOT IN ('cancelled', 'completed');

-- Log how many were fixed
DO $$
DECLARE
  v_fixed_count integer;
BEGIN
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % bookings with inconsistent service_id', v_fixed_count;
END $$;
```

### Step 2: Update edit_booking_time Function

Modify the function to update booking's service_id if it doesn't match:

```sql
-- After validating new slot, before updating booking:
IF v_new_slot_record.service_id != v_booking_record.service_id THEN
  -- Update booking's service_id to match the new slot's shift
  UPDATE bookings
  SET service_id = v_new_slot_record.service_id,
      updated_at = now()
  WHERE id = p_booking_id;
  
  -- Update v_booking_record for consistency
  v_booking_record.service_id := v_new_slot_record.service_id;
END IF;
```

## Testing

After implementing the fix:

1. **Run the migration** to fix existing data
2. **Run the test** to verify bookings can be updated:
   ```bash
   npm run test:booking-date-update-simple
   ```
3. **Manual test**: Try changing a booking's time and verify it works

## Prevention

To prevent this in the future:

1. **Add database constraint** (if possible):
   ```sql
   -- Ensure booking.service_id matches slot's shift's service_id
   -- (This might be complex with triggers, but worth considering)
   ```

2. **Add validation in booking creation**:
   ```sql
   -- In create_booking_with_lock function:
   -- Verify slot's shift service_id matches provided service_id
   SELECT sh.service_id INTO v_shift_service_id
   FROM slots s
   JOIN shifts sh ON s.shift_id = sh.id
   WHERE s.id = p_slot_id;
   
   IF v_shift_service_id != p_service_id THEN
     RAISE EXCEPTION 'Slot belongs to a different service';
   END IF;
   ```

3. **Add trigger** to keep service_id in sync:
   ```sql
   -- Trigger to update booking.service_id when slot changes
   CREATE OR REPLACE FUNCTION sync_booking_service_id()
   RETURNS TRIGGER AS $$
   BEGIN
     UPDATE bookings
     SET service_id = (
       SELECT sh.service_id
       FROM shifts sh
       WHERE sh.id = (
         SELECT shift_id FROM slots WHERE id = NEW.slot_id
       )
     )
     WHERE id = NEW.id;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

## Status

- ✅ **Data inconsistency identified**: Yes
- ✅ **Root cause identified**: Yes (shift service_id changed, bookings not updated)
- ✅ **Fix implemented**: Yes (migration created + function updated)
- ✅ **Frontend fix implemented**: Yes (state update logic enhanced)

## Implementation Complete

### Migration Created
- **File**: `supabase/migrations/20260125000000_fix_booking_service_id_inconsistency.sql`
- **What it does**:
  1. Fixes all existing bookings with inconsistent service_id
  2. Updates `edit_booking_time` function to automatically sync service_id when changing booking time
  3. Prevents future inconsistencies

### How to Apply

1. **Apply the migration** to your database:
   ```bash
   # If using Supabase CLI:
   supabase migration up
   
   # Or apply manually via Supabase dashboard SQL editor
   ```

2. **Verify the fix**:
   ```bash
   npm run test:booking-date-update-simple
   ```

3. **Check how many bookings were fixed**:
   The migration will log: `Fixed X bookings with inconsistent service_id`

## Next Steps

1. ✅ ~~Create migration to fix existing inconsistent bookings~~ **DONE**
2. ✅ ~~Update `edit_booking_time` function to sync service_id~~ **DONE**
3. ⏳ **Apply migration to database** (pending)
4. ⏳ **Test the fix with the test suite** (pending)
5. ⏳ **Monitor for any remaining inconsistencies** (ongoing)
