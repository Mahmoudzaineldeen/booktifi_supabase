# Fix Missing Schedules - Complete Guide

## Problem
Most services don't have schedules (shifts and slots), preventing customers and reception from booking them.

## Root Cause
1. Services were created without shifts
2. Even when shifts exist, slots aren't generated because employees aren't assigned
3. The slot generation function requires explicit employee assignments

## Solution Implemented

### 1. Database Migration ✅
**File**: `supabase/migrations/20250128000000_fix_slot_generation_with_fallback.sql`

This migration updates the `generate_slots_for_shift` function to use fallback logic:
1. **Priority 1**: Use employees explicitly assigned to the shift
2. **Priority 2**: Use employees assigned to the service (without specific shift)
3. **Priority 3**: Use all active employees for the tenant

### 2. Automated Script ✅
**File**: `scripts/create-missing-shifts-and-slots.js`

This script:
- Finds all services without shifts
- Creates default shifts (Monday-Friday, 9 AM - 6 PM)
- Generates slots for the next 60 days
- Regenerates slots for existing shifts

### 3. Auto-Create Shifts on Service Creation ✅
**File**: `src/pages/tenant/ServicesPage.tsx`

Updated to automatically:
- Create a default shift when a new service is created
- Generate slots for the next 60 days
- No manual intervention required

---

## How to Fix Existing Services

### Step 1: Apply the Database Migration

#### Option A: Via Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file: `supabase/migrations/20250128000000_fix_slot_generation_with_fallback.sql`
4. Copy the entire SQL content
5. Paste it into the SQL Editor
6. Click **Run** or press `Ctrl+Enter`
7. Verify you see: "Success. No rows returned"

#### Option B: Via Command Line
```bash
# If you have Supabase CLI installed
cd project
supabase db push
```

### Step 2: Run the Fix Script

```bash
# Navigate to project directory
cd project

# Run the script
node scripts/create-missing-shifts-and-slots.js
```

**Expected Output:**
```
============================================================
  CREATE MISSING SHIFTS AND SLOTS
============================================================

🔍 Finding services without shifts...

Found 15 services without shifts:

  - Tenant Name > Service Name 1
  - Tenant Name > Service Name 2
  ...

📅 Creating shifts and generating slots...

  ✓ Created shift for: Service Name 1
    → Generated 450 slots
  ✓ Created shift for: Service Name 2
    → Generated 450 slots
  ...

============================================================
✅ COMPLETE!
============================================================
  Shifts created: 15
  Slots generated: 6750
============================================================

🔄 Regenerating slots for all existing shifts...

Found 20 active shifts

  ✓ Tenant Name > Service Name: 450 slots
  ...

============================================================
✅ Regenerated 9000 slots for 20 shifts
============================================================

✅ All done! Services should now have schedules.
```

### Step 3: Verify the Fix

1. **Check in Admin Dashboard**:
   - Go to Services page
   - Click "Manage Schedule" on any service
   - You should see shifts and slots

2. **Check Public Booking Page**:
   - Go to the customer booking page
   - Select a service
   - You should see available time slots

3. **Check Reception Page**:
   - Go to reception booking page
   - Select a service
   - You should see available time slots

---

## For New Services (Going Forward)

New services will automatically:
1. Get a default shift (Monday-Friday, 9 AM - 6 PM)
2. Have slots generated for the next 60 days
3. Be immediately bookable

**No manual intervention required!**

---

## Customizing Schedules

### Change Default Shift Times

Edit the shift after service creation:
1. Go to **Services** page
2. Click **Manage Schedule** on the service
3. Edit the shift:
   - Change days of week
   - Change start/end times
   - Add multiple shifts
4. Slots will be regenerated automatically

### Assign Specific Employees

1. Go to **Services** page
2. Click **Manage Schedule**
3. Click **Assign Employees** on a shift
4. Select employees
5. Slots will be regenerated for those employees

---

## Troubleshooting

### Issue: Script says "All services have shifts" but booking still doesn't work

**Solution**: Regenerate slots manually
```bash
node scripts/create-missing-shifts-and-slots.js
```

The script will regenerate slots for all existing shifts.

### Issue: No employees in the system

**Solution**: Add at least one employee
1. Go to **Users** page
2. Create a user with role "Employee"
3. Run the fix script again

### Issue: Slots not showing for specific dates

**Possible causes**:
1. **Day of week not in shift**: Check shift's `days_of_week`
2. **Date too far in future**: Slots are only generated 60 days ahead
3. **Shift not active**: Check `is_active` flag on shift

**Solution**: Regenerate slots
```sql
-- In Supabase SQL Editor
SELECT generate_slots_for_shift(
  'shift-id-here',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '60 days'
);
```

### Issue: Migration fails with "function already exists"

**Solution**: This is fine! It means the function is already updated. The migration uses `CREATE OR REPLACE` so it should work, but if it fails, the function might already be correct.

---

## Technical Details

### Default Shift Configuration
```javascript
{
  days_of_week: [1, 2, 3, 4, 5], // Monday to Friday
  start_time_utc: '09:00:00',     // 9 AM
  end_time_utc: '18:00:00',       // 6 PM
  is_active: true
}
```

### Slot Generation
- **Duration**: Based on service's `duration_minutes`
- **Capacity**: Based on service's `capacity_per_slot`
- **Range**: Next 60 days from today
- **Employee Assignment**: Automatic fallback logic

### Fallback Logic
```
1. Employees assigned to shift (shift_id in employee_services)
   ↓ (if none)
2. Employees assigned to service (service_id in employee_services, shift_id IS NULL)
   ↓ (if none)
3. All active employees for the tenant
```

---

## Files Modified

1. ✅ `supabase/migrations/20250128000000_fix_slot_generation_with_fallback.sql` - NEW
2. ✅ `scripts/create-missing-shifts-and-slots.js` - NEW
3. ✅ `src/pages/tenant/ServicesPage.tsx` - UPDATED
4. ✅ `src/pages/public/CheckoutPage.tsx` - FIXED (duplicate key)

---

## Summary

### What Was Fixed
- ✅ Slot generation function now works without explicit employee assignments
- ✅ Script to create missing shifts and generate slots
- ✅ Auto-create shifts when new services are created
- ✅ Regenerate slots for existing shifts

### What You Need to Do
1. Apply the database migration (Step 1)
2. Run the fix script (Step 2)
3. Verify bookings work (Step 3)

### Time Required
- **Migration**: 1 minute
- **Script execution**: 2-5 minutes (depending on number of services)
- **Verification**: 2 minutes
- **Total**: ~10 minutes

---

## Success Criteria

After applying the fix, you should be able to:
- ✅ See time slots when booking as a customer
- ✅ See time slots when booking at reception
- ✅ Create new services and immediately book them
- ✅ All services have schedules (shifts and slots)

---

## Need Help?

If you encounter issues:
1. Check the troubleshooting section above
2. Review the console output from the script
3. Check Supabase logs for errors
4. Verify database migration was applied successfully

---

**Created**: 2025-01-28  
**Status**: Ready to apply  
**Impact**: Fixes booking for all services


