# Test Booking Time Change - Receptionist

## Issue
User reported that changing a booking time as a receptionist doesn't update the UI.

## Changes Made

### 1. Enhanced Logging
Added comprehensive logging to `updateBookingTime()` function:
- Logs booking ID, slot ID, API URL before request
- Logs response status and success
- Logs error details if request fails
- Logs when bookings are refreshed

### 2. Improved Refresh Logic
- Added 500ms delay before refreshing bookings to ensure backend has updated
- Close modal first, then refresh bookings
- Better error handling with detailed error messages

### 3. Response Handling
- Properly parses JSON response
- Handles non-JSON error responses gracefully
- Shows detailed error messages to user

## Testing Steps

1. **Login as Receptionist**
   - Navigate to Reception Page
   - Find an active booking (not cancelled/completed)

2. **Open Change Time Modal**
   - Click "Change Time" button on a booking card
   - Modal should open showing current time slot

3. **Select New Time**
   - Use date picker to select a new date
   - Wait for slots to load
   - Click on a new time slot (it should highlight in blue)
   - Click "Update Time" button

4. **Verify Update**
   - Check browser console for logs:
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
   - Modal should close
   - Success alert should appear
   - Booking card should show new time slot
   - Booking should appear in correct date section

5. **Check Backend Logs**
   - Look for:
     ```
     🔄 ========================================
     🔄 Booking Time Edit Request
        Booking ID: <id>
        New Slot ID: <slot_id>
     [Booking Time Edit] ✅ Success
     ```

## Troubleshooting

### If booking doesn't update:

1. **Check Console for Errors**
   - Look for any error messages
   - Check if API call succeeded (status 200)
   - Verify response contains success data

2. **Check Network Tab**
   - Verify PATCH request to `/bookings/:id/time`
   - Check request payload: `{ slot_id: "..." }`
   - Verify response status is 200
   - Check response body for success/error

3. **Check Backend Logs**
   - Verify RPC function `edit_booking_time` was called
   - Check for any database errors
   - Verify booking was actually updated in database

4. **Manual Database Check**
   ```sql
   SELECT id, slot_id, customer_name, 
          (SELECT slot_date FROM time_slots WHERE id = bookings.slot_id) as slot_date,
          (SELECT start_time FROM time_slots WHERE id = bookings.slot_id) as start_time
   FROM bookings 
   WHERE id = '<booking_id>';
   ```

5. **Force Refresh**
   - Try refreshing the page manually
   - Check if booking appears with new time

### Common Issues:

1. **Slot Not Selected**
   - Error: "Please select a new time slot"
   - Solution: Make sure to click on a slot (it should highlight)

2. **Slot Not Available**
   - Error: "Not enough capacity" or "Slot not available"
   - Solution: Select a different slot with available capacity

3. **Permission Error**
   - Error: 403 Forbidden
   - Solution: Verify user is logged in as receptionist or tenant_admin

4. **Booking Not Found**
   - Error: 404 Not Found
   - Solution: Verify booking ID is correct

## Expected Behavior

✅ Modal opens with current time slot displayed
✅ Date picker allows selecting new date
✅ Slots load automatically when date changes
✅ Clicking a slot highlights it in blue
✅ "Update Time" button is enabled when slot is selected
✅ Confirmation dialog appears before update
✅ Success alert appears after update
✅ Modal closes automatically
✅ Booking list refreshes automatically
✅ Booking card shows new time slot
✅ Booking appears in correct date section (today/all)

## Files Modified

- `src/pages/reception/ReceptionPage.tsx`
  - Enhanced `updateBookingTime()` function with better logging
  - Added delay before refresh to ensure backend update completes
  - Improved error handling and user feedback

---

**Status**: ✅ Enhanced with better logging and error handling
**Last Updated**: 2026-01-25
