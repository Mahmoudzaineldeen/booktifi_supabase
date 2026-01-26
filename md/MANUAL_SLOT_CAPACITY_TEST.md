# Manual Testing Guide: Slot Capacity Fix

This guide helps you manually test the slot capacity fix to ensure it works correctly.

## Prerequisites

1. **Access to Supabase Dashboard** or database query tool
2. **API access** (Railway backend URL)
3. **Test accounts**:
   - Receptionist account (for creating bookings)
   - Tenant Admin account (for cancelling bookings)

## Test Setup

### 1. Find a Test Slot

Run this query in Supabase to find a slot with available capacity:

```sql
SELECT 
  id,
  slot_date,
  start_time,
  end_time,
  available_capacity,
  booked_count,
  original_capacity,
  is_available
FROM slots
WHERE is_available = true
  AND available_capacity > 0
  AND slot_date >= CURRENT_DATE
ORDER BY slot_date, start_time
LIMIT 5;
```

**Note the `id` of a slot** - you'll need it for testing.

### 2. Get Test Credentials

- **Receptionist Token**: Login as receptionist and get JWT token
- **Tenant Admin Token**: Login as tenant admin and get JWT token

## Test Scenarios

### Test 1: Booking Creation Reduces Capacity

**Objective**: Verify that creating a booking reduces slot capacity immediately.

**Steps**:

1. **Check initial slot capacity:**
   ```sql
   SELECT 
     id,
     available_capacity,
     booked_count,
     original_capacity
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```
   **Note**: `available_capacity` and `booked_count`

2. **Create a booking via API:**
   ```bash
   curl -X POST https://your-api-url/api/bookings/create \
     -H "Authorization: Bearer <RECEPTIONIST_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "slot_id": "<YOUR_SLOT_ID>",
       "service_id": "<SERVICE_ID>",
       "tenant_id": "<TENANT_ID>",
       "customer_name": "Test Customer",
       "customer_phone": "+966501234567",
       "visitor_count": 1,
       "adult_count": 1,
       "child_count": 0,
       "total_price": 100.00
     }'
   ```

3. **Wait 2 seconds** (for trigger to fire)

4. **Check slot capacity again:**
   ```sql
   SELECT 
     id,
     available_capacity,
     booked_count,
     original_capacity
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```

5. **Verify**:
   - ✅ `available_capacity` decreased by 1
   - ✅ `booked_count` increased by 1
   - ✅ Booking status is `'pending'`

**Expected Result**: Capacity should decrease immediately, even though booking is `'pending'`.

---

### Test 2: Booking Cancellation Restores Capacity

**Objective**: Verify that cancelling a booking restores slot capacity.

**Steps**:

1. **Create a booking** (follow Test 1 steps 1-2)

2. **Note the booking ID** from the API response

3. **Check slot capacity after creation:**
   ```sql
   SELECT available_capacity, booked_count
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```
   **Note**: `available_capacity` (should be reduced)

4. **Cancel the booking via API:**
   ```bash
   curl -X PATCH https://your-api-url/api/bookings/<BOOKING_ID> \
     -H "Authorization: Bearer <TENANT_ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "status": "cancelled"
     }'
   ```

5. **Wait 2 seconds** (for trigger to fire)

6. **Check slot capacity again:**
   ```sql
   SELECT available_capacity, booked_count
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```

7. **Verify**:
   - ✅ `available_capacity` increased by 1 (restored)
   - ✅ `booked_count` decreased by 1
   - ✅ Booking status is `'cancelled'`

**Expected Result**: Capacity should be restored when booking is cancelled, even if it was `'pending'`.

---

### Test 3: Multiple Bookings Reduce Capacity

**Objective**: Verify that multiple bookings correctly reduce capacity.

**Steps**:

1. **Check initial slot capacity:**
   ```sql
   SELECT available_capacity, booked_count
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```
   **Note**: Initial values

2. **Create 3 bookings** (repeat Test 1 step 2, three times)

3. **Wait 2 seconds** after all bookings are created

4. **Check final slot capacity:**
   ```sql
   SELECT available_capacity, booked_count
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```

5. **Verify**:
   - ✅ `available_capacity` decreased by 3
   - ✅ `booked_count` increased by 3

6. **Cleanup**: Cancel all 3 bookings (follow Test 2 step 4)

**Expected Result**: Each booking should reduce capacity by its `visitor_count`.

---

### Test 4: Confirmed Booking Also Reduces Capacity

**Objective**: Verify that confirmed bookings also reduce capacity (if created as confirmed).

**Steps**:

1. **Create a booking** (follow Test 1)

2. **Confirm the booking:**
   ```bash
   curl -X PATCH https://your-api-url/api/bookings/<BOOKING_ID> \
     -H "Authorization: Bearer <TENANT_ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "status": "confirmed"
     }'
   ```

3. **Check slot capacity:**
   ```sql
   SELECT available_capacity, booked_count
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```

4. **Verify**:
   - ✅ Capacity should remain reduced (not double-reduced)
   - ✅ Capacity was already reduced when booking was created as `'pending'`

**Expected Result**: Confirming a booking should NOT reduce capacity again (it was already reduced).

---

### Test 5: Recalculation Function

**Objective**: Verify the recalculation function fixes existing data.

**Steps**:

1. **Run recalculation function:**
   ```sql
   SELECT * FROM recalculate_all_slot_capacities();
   ```

2. **Check results:**
   - Should return a table with slot details
   - Shows old vs new capacity values
   - Updates all slots to correct values

3. **Verify a specific slot:**
   ```sql
   SELECT 
     id,
     available_capacity,
     booked_count,
     original_capacity,
     (SELECT COUNT(*) FROM bookings WHERE slot_id = slots.id AND status IN ('pending', 'confirmed')) as actual_bookings
   FROM slots
   WHERE id = '<YOUR_SLOT_ID>';
   ```

4. **Verify**:
   - ✅ `available_capacity = original_capacity - actual_bookings`
   - ✅ `booked_count = actual_bookings`

**Expected Result**: All slots should have correct capacity values.

---

## Troubleshooting

### Issue: Capacity not decreasing

**Check**:
1. Are triggers active?
   ```sql
   SELECT * FROM pg_trigger WHERE tgname LIKE '%slot_capacity%';
   ```

2. Are functions correct?
   ```sql
   SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%slot_capacity%';
   ```

3. Check trigger logs:
   ```sql
   -- Enable logging if needed
   SET client_min_messages TO NOTICE;
   ```

### Issue: Capacity not restoring on cancellation

**Check**:
1. Is booking status actually `'cancelled'`?
   ```sql
   SELECT id, status FROM bookings WHERE id = '<BOOKING_ID>';
   ```

2. Was booking `'pending'` or `'confirmed'` before cancellation?
   ```sql
   -- Check audit logs or booking history
   ```

3. Is UPDATE trigger firing?
   ```sql
   -- Check if trigger exists
   SELECT * FROM pg_trigger WHERE tgname = 'trigger_manage_slot_capacity_on_update';
   ```

### Issue: Double capacity reduction

**Check**:
1. Is RPC function also updating capacity?
   - Check `create_booking_with_lock` function
   - Should update capacity AND trigger should also fire
   - This is intentional (double protection)

2. If capacity is reduced twice:
   - Check if trigger is firing twice
   - Check if RPC function is being called multiple times

## Success Criteria

All tests should pass if:

- ✅ **Test 1**: Capacity decreases when booking is created (pending)
- ✅ **Test 2**: Capacity restores when booking is cancelled (from pending)
- ✅ **Test 3**: Multiple bookings reduce capacity correctly
- ✅ **Test 4**: Confirmed bookings don't double-reduce capacity
- ✅ **Test 5**: Recalculation function fixes existing data

## Automated Testing

You can also use the automated test script:

```bash
# Set environment variables
export TEST_TENANT_ID="your-tenant-id"
export TEST_SERVICE_ID="your-service-id"
export TEST_SLOT_ID="your-slot-id"
export TEST_RECEPTIONIST_TOKEN="your-receptionist-token"
export VITE_API_URL="https://your-api-url/api"

# Run tests
node tests/test-slot-capacity-fix.js
```

## Notes

- **Timing**: Wait 1-2 seconds after creating/cancelling bookings for triggers to fire
- **Database**: Make sure migrations are applied (`20260123000002_permanent_slot_capacity_fix.sql`)
- **RPC Function**: Make sure `create_booking_with_lock` is updated
- **Cleanup**: Always cancel test bookings to restore capacity
