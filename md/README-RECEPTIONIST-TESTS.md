# Receptionist Edit Booking & Change Time - Test Suite

## Overview
This test suite verifies that receptionists can:
1. ✅ Edit booking details (customer info, status, price, etc.)
2. ✅ Change booking time (reschedule to new time slot)

## Test Files

### 1. Automated Test Script
**File**: `tests/test-receptionist-edit-booking.js`

**Description**: Node.js script that automatically tests both functionalities.

**Usage**:
```bash
# Set environment variables (optional)
export API_URL=http://localhost:3000
export RECEPTIONIST_EMAIL=receptionist@example.com
export RECEPTIONIST_PASSWORD=password123
export TEST_BOOKING_ID=optional-booking-id
export RESTORE_BOOKING=false  # Set to false to keep test changes

# Run test
npm run test:receptionist-edit

# Or directly
node tests/test-receptionist-edit-booking.js
```

**What it tests**:
- ✅ Login as receptionist
- ✅ Find an active booking
- ✅ Edit booking (name, email, visitor count, price, status, notes)
- ✅ Verify edit was saved
- ✅ Find available time slots
- ✅ Change booking time
- ✅ Verify time was updated
- ✅ (Optional) Restore original booking data

**Requirements**:
- Node.js 18+ (for native fetch)
- Backend server running
- Valid receptionist account
- At least one active booking

### 2. Manual Test Guide
**File**: `tests/test-receptionist-edit-booking-manual.md`

**Description**: Step-by-step manual testing instructions.

**Usage**: Follow the guide in the markdown file to manually test both features.

**What it covers**:
- ✅ Detailed step-by-step instructions
- ✅ Expected results for each step
- ✅ Error case testing
- ✅ UI/UX verification
- ✅ Troubleshooting guide
- ✅ Test checklist

## Quick Test (5 minutes)

### Test Edit Booking:
1. Login as receptionist
2. Click "Edit Booking" on any booking
3. Change customer name to "Test User"
4. Change visitor count to 2
5. Click "Save"
6. ✅ Verify: Booking card shows "Test User" and visitor count 2

### Test Change Time:
1. Click "Change Time" on any active booking
2. Select a new date (next few days)
3. Click on an available time slot
4. Click "Update Time"
5. Confirm the dialog
6. ✅ Verify: Booking card shows new date and time

## Expected Results

### Edit Booking
- ✅ Modal opens with pre-filled data
- ✅ All fields editable
- ✅ Changes save successfully
- ✅ UI updates immediately
- ✅ No console errors
- ✅ Changes persist after refresh

### Change Time
- ✅ Modal opens with current time
- ✅ Date picker works
- ✅ Slots load automatically
- ✅ Slot selection works
- ✅ Time updates successfully
- ✅ New ticket generated (backend)
- ✅ UI updates immediately
- ✅ No console errors

## Troubleshooting

### Test Script Fails

**Error: "Login failed"**
- Check credentials are correct
- Verify backend is running
- Check API_URL is correct

**Error: "No active bookings found"**
- Create a booking first
- Or provide TEST_BOOKING_ID

**Error: "Failed to fetch slots"**
- Verify service has shifts configured
- Check slots exist for selected date
- Verify tenant_id is correct

**Error: "Change time failed"**
- Check slot has available capacity
- Verify booking is not cancelled/completed
- Check backend logs for RPC errors

### Manual Test Issues

**Modal doesn't open**
- Check browser console for errors
- Verify user is logged in as receptionist
- Check React component state

**Changes don't save**
- Check network tab for failed requests
- Verify backend endpoint is accessible
- Check user permissions

**Time doesn't change**
- Verify slot is selected (highlighted)
- Check slot has available capacity
- Verify booking status allows time change

## Test Coverage

### Edit Booking
- [x] Customer name update
- [x] Email update
- [x] Phone update
- [x] Visitor count update
- [x] Total price update
- [x] Status update
- [x] Notes update
- [x] Multiple fields at once
- [x] Validation errors
- [x] Permission checks

### Change Time
- [x] Open modal
- [x] Display current time
- [x] Date picker functionality
- [x] Slot loading
- [x] Slot selection
- [x] Time update
- [x] Ticket regeneration
- [x] Old ticket invalidation
- [x] UI refresh
- [x] Error handling

## Running Tests in CI/CD

```bash
# Set environment variables
export API_URL=https://your-backend-url.com
export RECEPTIONIST_EMAIL=test-receptionist@example.com
export RECEPTIONIST_PASSWORD=test-password
export RESTORE_BOOKING=true

# Run tests
npm run test:receptionist-edit
```

## Test Data Requirements

### Minimum Test Data:
- 1 active booking (status: pending or confirmed)
- 1 service with shifts configured
- At least 2 time slots (1 current, 1 future)
- Receptionist user account

### Recommended Test Data:
- Multiple bookings (different statuses)
- Multiple services
- Slots across different dates
- Bookings with different visitor counts

## Success Criteria

✅ **All automated tests pass**
✅ **Manual test checklist complete**
✅ **No console errors**
✅ **No backend errors**
✅ **UI updates correctly**
✅ **Database reflects changes**
✅ **Tickets regenerate correctly**

---

**Last Updated**: 2026-01-25
**Status**: ✅ Ready for Testing
