# Testing Summary: Slot Capacity Fix

## Test Files Created

### 1. Automated Test Script
**File**: `tests/test-slot-capacity-fix.js`

**What it tests**:
- ✅ Booking creation reduces slot capacity (pending status)
- ✅ Booking cancellation restores slot capacity (from pending)
- ✅ Multiple bookings reduce capacity correctly

**How to run**:
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

### 2. Manual Testing Guide
**File**: `tests/MANUAL_SLOT_CAPACITY_TEST.md`

**What it covers**:
- ✅ Step-by-step manual testing procedures
- ✅ 5 comprehensive test scenarios
- ✅ SQL queries for verification
- ✅ Troubleshooting guide
- ✅ Success criteria

**How to use**:
1. Open the guide
2. Follow each test scenario step-by-step
3. Verify results match expected outcomes

### 3. SQL Verification Script
**File**: `tests/verify-slot-capacity-triggers.sql`

**What it does**:
- ✅ Checks if triggers exist and are active
- ✅ Verifies functions are defined correctly
- ✅ Finds test slots with available capacity
- ✅ Verifies capacity calculations
- ✅ Identifies slots with incorrect capacity
- ✅ Provides test queries for manual trigger testing

**How to use**:
1. Open Supabase SQL Editor
2. Copy and paste queries from the script
3. Replace placeholders (`<SLOT_ID>`, `<TENANT_ID>`, etc.)
4. Run queries to verify triggers are working

## Quick Test Checklist

### Before Testing
- [ ] Migration `20260123000002_permanent_slot_capacity_fix.sql` is applied
- [ ] RPC function `create_booking_with_lock` is updated
- [ ] You have access to Supabase dashboard
- [ ] You have API access (Railway backend)
- [ ] You have test credentials (receptionist token)

### Test 1: Basic Capacity Reduction
- [ ] Find a slot with available capacity
- [ ] Note initial `available_capacity` and `booked_count`
- [ ] Create a booking via API
- [ ] Wait 2 seconds
- [ ] Verify `available_capacity` decreased by `visitor_count`
- [ ] Verify `booked_count` increased by `visitor_count`

### Test 2: Capacity Restoration
- [ ] Create a booking (from Test 1)
- [ ] Note capacity after creation
- [ ] Cancel the booking via API
- [ ] Wait 2 seconds
- [ ] Verify `available_capacity` increased by `visitor_count`
- [ ] Verify `booked_count` decreased by `visitor_count`

### Test 3: Multiple Bookings
- [ ] Note initial capacity
- [ ] Create 3 bookings
- [ ] Verify capacity decreased by 3
- [ ] Cancel all 3 bookings
- [ ] Verify capacity restored

### Test 4: Recalculation Function
- [ ] Run `SELECT * FROM recalculate_all_slot_capacities();`
- [ ] Verify function returns results
- [ ] Check a specific slot's capacity matches expected value

## Expected Results

### ✅ Success Indicators

1. **Booking Creation**:
   - Slot `available_capacity` decreases immediately
   - Slot `booked_count` increases immediately
   - Works for both `'pending'` and `'confirmed'` bookings

2. **Booking Cancellation**:
   - Slot `available_capacity` increases
   - Slot `booked_count` decreases
   - Works from both `'pending'` and `'confirmed'` statuses

3. **Multiple Bookings**:
   - Each booking reduces capacity by its `visitor_count`
   - Capacity calculations are accurate

4. **Recalculation**:
   - Function fixes any inconsistencies
   - All slots have correct capacity values

### ❌ Failure Indicators

1. **Capacity not decreasing**:
   - Booking created but slot capacity unchanged
   - Check triggers are active
   - Check functions are correct

2. **Capacity not restoring**:
   - Booking cancelled but slot capacity unchanged
   - Check booking status is actually `'cancelled'`
   - Check trigger is firing

3. **Double reduction**:
   - Capacity reduced twice for single booking
   - Check if trigger fires multiple times
   - Check if RPC function is called multiple times

## Troubleshooting

### Issue: Triggers not firing

**Solution**:
```sql
-- Check if triggers are enabled
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%slot_capacity%';

-- If disabled, enable them
ALTER TABLE bookings ENABLE TRIGGER trigger_reduce_slot_capacity_on_insert;
ALTER TABLE bookings ENABLE TRIGGER trigger_manage_slot_capacity_on_update;
```

### Issue: Functions not found

**Solution**:
```sql
-- Check if functions exist
SELECT proname FROM pg_proc WHERE proname LIKE '%slot_capacity%';

-- If missing, run the migration
-- File: supabase/migrations/20260123000002_permanent_slot_capacity_fix.sql
```

### Issue: Capacity calculations incorrect

**Solution**:
```sql
-- Run recalculation function
SELECT * FROM recalculate_all_slot_capacities();

-- This will fix all slots
```

## Next Steps After Testing

1. **If all tests pass**:
   - ✅ Fix is working correctly
   - ✅ Deploy to production
   - ✅ Monitor for any issues

2. **If tests fail**:
   - ❌ Check migration was applied
   - ❌ Check RPC function was updated
   - ❌ Check triggers are active
   - ❌ Run recalculation function
   - ❌ Review error logs

3. **Production Deployment**:
   - Apply migration in production Supabase
   - Deploy updated RPC function
   - Run recalculation function
   - Monitor slot capacity for 24 hours

## Support

If you encounter issues:
1. Check the troubleshooting section
2. Review the manual testing guide
3. Check Supabase logs for trigger errors
4. Verify all migrations are applied
