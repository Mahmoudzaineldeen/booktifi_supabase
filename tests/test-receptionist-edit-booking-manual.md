# Manual Test Guide: Receptionist Edit Booking & Change Time

## Overview
This guide provides step-by-step instructions to manually test both "Edit Booking" and "Change Time" functionality for receptionists.

## Prerequisites
- ✅ Backend server running
- ✅ Logged in as receptionist
- ✅ At least one active booking exists (not cancelled/completed)
- ✅ Browser console open (F12) for debugging

---

## Test 1: Edit Booking

### Step 1: Navigate to Reception Page
1. Login as receptionist
2. Navigate to Reception Page
3. Verify you can see booking cards

### Step 2: Open Edit Booking Modal
1. Find an active booking card
2. Click the **"Edit Booking"** button (with Edit icon)
3. **Expected**: Modal opens with pre-filled booking data

### Step 3: Edit Customer Information
1. **Change Customer Name**: Add " (Test)" to the name
2. **Change Email**: Update to a test email if empty
3. **Change Visitor Count**: Increase by 1
4. **Change Total Price**: Add 10 to the price
5. **Change Status**: If pending, change to confirmed
6. **Add Notes**: Type "Test edit from manual test"

### Step 4: Save Changes
1. Click **"Save Changes"** button
2. **Expected**: 
   - Modal closes
   - Success alert appears
   - Booking card updates with new information

### Step 5: Verify Changes
1. Check the booking card displays:
   - ✅ Updated customer name
   - ✅ Updated visitor count
   - ✅ Updated price
   - ✅ Updated status badge
2. Click booking card to open details modal
3. **Expected**: All changes are visible in details

### Step 6: Check Console Logs
Open browser console (F12) and verify:
```
✅ No errors
✅ Booking updated successfully message
✅ fetchBookings() called
```

---

## Test 2: Change Time

### Step 1: Open Change Time Modal
1. Find an active booking (not cancelled/completed)
2. Click the **"Change Time"** button (with CalendarClock icon)
3. **Expected**: 
   - Modal opens
   - Current time slot displayed in gray box
   - Date picker visible
   - Slot grid visible (may be loading)

### Step 2: Select New Date
1. Click the date picker
2. Select a date in the future (next 1-7 days)
3. **Expected**: 
   - Date picker updates
   - Slots automatically load for that date
   - Loading spinner appears briefly
   - Available slots appear in grid

### Step 3: Select New Time Slot
1. Wait for slots to load
2. **Expected**: Grid shows available slots with:
   - Start time
   - Available capacity
3. Click on a slot
4. **Expected**: 
   - Slot highlights in blue
   - "Update Time" button becomes enabled

### Step 4: Confirm and Update
1. Click **"Update Time"** button
2. **Expected**: Confirmation dialog appears
3. Click **"OK"** to confirm
4. **Expected**: 
   - Modal closes
   - Success alert: "Booking time updated successfully!"
   - Booking list refreshes

### Step 5: Verify Time Change
1. Check the booking card displays:
   - ✅ New date
   - ✅ New time slot
   - ✅ Same customer name (unchanged)
2. Check console logs:
   ```
   [ReceptionPage] ========================================
   [ReceptionPage] Updating booking time...
   [ReceptionPage]   Booking ID: <id>
   [ReceptionPage]   New Slot ID: <slot_id>
   [ReceptionPage] Response status: 200
   [ReceptionPage] Response ok: true
   [ReceptionPage] ✅ Success response: {...}
   [ReceptionPage] Refreshing bookings...
   [ReceptionPage] ✅ Bookings refreshed
   ```

### Step 6: Verify in Database (Optional)
If you have database access:
```sql
SELECT 
  id,
  customer_name,
  slot_id,
  (SELECT slot_date FROM time_slots WHERE id = bookings.slot_id) as new_date,
  (SELECT start_time FROM time_slots WHERE id = bookings.slot_id) as new_start_time,
  (SELECT end_time FROM time_slots WHERE id = bookings.slot_id) as new_end_time
FROM bookings 
WHERE id = '<booking_id>';
```

---

## Test 3: Combined Test (Edit + Change Time)

### Scenario
Test that you can edit booking details AND change time in sequence.

### Steps
1. **Edit Booking**: Change customer name and price
2. **Save**: Verify changes saved
3. **Change Time**: Select new time slot
4. **Update**: Verify time changed
5. **Verify**: 
   - ✅ Customer name still shows edit
   - ✅ Price still shows edit
   - ✅ Time shows new slot
   - ✅ All changes persist

---

## Test 4: Error Cases

### Test 4.1: Change Time Without Selecting Slot
1. Open Change Time modal
2. Don't select a slot
3. Click "Update Time"
4. **Expected**: Alert "Please select a new time slot"

### Test 4.2: Change Time to Unavailable Slot
1. Open Change Time modal
2. Select a date with no available slots
3. **Expected**: Message "No available time slots for this date"

### Test 4.3: Edit Booking with Invalid Data
1. Open Edit Booking modal
2. Set visitor count to 0 or negative
3. Set price to negative
4. Try to save
5. **Expected**: Validation error or backend rejection

### Test 4.4: Change Time for Cancelled Booking
1. Find a cancelled booking
2. **Expected**: "Change Time" button should NOT be visible

---

## Test 5: UI/UX Verification

### Visual Checks
- ✅ Modals open smoothly
- ✅ Loading states show spinners
- ✅ Selected slots highlight correctly
- ✅ Buttons are enabled/disabled appropriately
- ✅ Success/error messages are clear
- ✅ No translation keys visible (e.g., "status.pending")
- ✅ All text is in correct language (Arabic/English)

### Responsiveness
- ✅ Modals work on mobile viewport
- ✅ Slot grid scrolls if many slots
- ✅ Date picker works on touch devices

---

## Expected Results Summary

### Edit Booking
✅ Modal opens with pre-filled data
✅ All fields are editable
✅ Changes save successfully
✅ UI updates immediately
✅ No errors in console
✅ Booking persists after page refresh

### Change Time
✅ Modal opens with current time
✅ Date picker works
✅ Slots load automatically
✅ Slot selection works
✅ Time updates successfully
✅ New ticket generated (check backend logs)
✅ Old ticket invalidated (qr_scanned = true)
✅ UI updates immediately
✅ No errors in console

---

## Troubleshooting

### Issue: Changes don't save
**Check:**
- Browser console for errors
- Network tab for failed requests
- Backend logs for errors
- User permissions (must be receptionist)

### Issue: Time doesn't change
**Check:**
- Slot is actually selected (highlighted)
- Slot has available capacity
- Booking is not cancelled/completed
- Backend RPC function exists
- Database constraints allow change

### Issue: UI doesn't update
**Check:**
- `fetchBookings()` is called after update
- Booking state is updated
- React re-renders triggered
- No caching issues

### Issue: Modal doesn't close
**Check:**
- Success response received
- State updates correctly
- No errors preventing cleanup

---

## Test Checklist

### Edit Booking
- [ ] Modal opens
- [ ] Fields are editable
- [ ] Customer name updates
- [ ] Email updates
- [ ] Visitor count updates
- [ ] Price updates
- [ ] Status updates
- [ ] Notes save
- [ ] Changes persist
- [ ] UI refreshes

### Change Time
- [ ] Modal opens
- [ ] Current time displayed
- [ ] Date picker works
- [ ] Slots load on date change
- [ ] Slot selection works
- [ ] Confirmation dialog appears
- [ ] Time updates successfully
- [ ] New ticket generated
- [ ] UI refreshes
- [ ] Booking shows new time

### Error Handling
- [ ] Validation errors show
- [ ] Network errors handled
- [ ] Permission errors handled
- [ ] User-friendly error messages

---

**Last Updated**: 2026-01-25
**Status**: ✅ Ready for Testing
