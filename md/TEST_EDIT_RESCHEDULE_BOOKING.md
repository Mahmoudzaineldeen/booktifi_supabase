# Test Guide: Receptionist Edit & Reschedule Booking

## Quick Test Steps

### Test 1: Edit Booking from Booking Card
1. **Login** as receptionist (`receptionist1@bookati.local` / `111111`)
2. **Navigate** to Reception Page
3. **Find** a booking card (any status)
4. **Look for** "Edit Booking" button at the bottom of the card
5. **Click** "Edit Booking" button
6. **Verify**:
   - ✅ Modal opens
   - ✅ Customer information is pre-filled
   - ✅ All fields are editable
7. **Change** customer name to "Test Edit"
8. **Click** "Save Changes"
9. **Verify**:
   - ✅ Success message appears
   - ✅ Modal closes
   - ✅ Booking card shows updated name

### Test 2: Reschedule from Booking Card
1. **Find** a booking with status "pending" or "confirmed"
2. **Look for** "Reschedule" button (next to Edit Booking)
3. **Click** "Reschedule" button
4. **Verify**:
   - ✅ Modal opens
   - ✅ Automatically scrolls to reschedule section
   - ✅ Current time slot is displayed
   - ✅ Dropdown shows available future slots
5. **Select** a new time slot from dropdown
6. **Click** "Save Changes"
7. **Verify**:
   - ✅ Success message appears
   - ✅ Booking is updated with new time slot
   - ✅ Old slot capacity is released
   - ✅ New slot capacity is reserved

### Test 3: Edit from Booking Details Modal
1. **Click** on a booking card to open details modal
2. **Look for** "Edit Booking" and "Reschedule" buttons at the bottom
3. **Click** "Edit Booking"
4. **Verify** same as Test 1

### Test 4: Reschedule from Booking Details Modal
1. **Open** booking details modal for an active booking
2. **Click** "Reschedule" button
3. **Verify** same as Test 2

## Expected Results

### ✅ Success Indicators:
- Buttons are visible on booking cards
- Buttons are visible in booking details modal
- Modal opens when clicking buttons
- Form is pre-filled with booking data
- Available slots load in dropdown
- Changes save successfully
- Booking updates in real-time
- No console errors

### ❌ If Issues Occur:
- **Buttons not visible**: Check browser console for errors
- **Modal doesn't open**: Check `isEditBookingModalOpen` state
- **Slots not loading**: Check network tab for API calls
- **Save fails**: Check backend logs for permission errors

## Visual Verification

### Booking Card Should Show:
```
[Booking Card]
  Customer Name: John Doe
  Phone: +966501234567
  ...
  [Edit Booking] [Reschedule]  ← These buttons
```

### Booking Details Modal Should Show:
```
[Booking Details Modal]
  Customer Information
  ...
  [Edit Booking] [Reschedule]  ← These buttons at bottom
  [Mark Complete] [Cancel Booking]
```

### Edit Modal Should Show:
```
[Edit Booking Modal]
  Customer Information
    - Name: [editable]
    - Phone: [editable]
    - Email: [editable]
    - Visitor Count: [editable]
    - Total Price: [editable]
    - Notes: [editable]
  
  Reschedule Booking
    - Current Time Slot: [display only]
    - Select New Time Slot: [dropdown]
  
  [Save Changes] [Cancel]
```

---

**Ready for Testing**: ✅ All code implemented
**Next Step**: Test in browser and verify functionality
