# Manual Testing Guide - Implemented Tasks

## Prerequisites
- Railway backend is running and accessible
- Frontend is running (npm run dev)
- Test user accounts available (cashier, receptionist, tenant_admin)

---

## TASK 1: Railway Backend ✅

### Test Steps:
1. Open browser DevTools (F12)
2. Go to Network tab
3. Navigate to any page in the app
4. Check API requests

### Expected Results:
- ✅ All API requests go to `https://booktifisupabase-production.up.railway.app/api`
- ✅ No requests to `localhost:3001` or `127.0.0.1`
- ✅ Console shows: `[getApiUrl] Using VITE_API_URL: ...` or Railway URL

---

## TASK 2: QR Code Structure ✅

### Test Steps:
1. Create a booking (or use existing booking)
2. Download/view the booking ticket PDF
3. Scan the QR code with any QR scanner app
4. Verify the QR code contains only a UUID (booking ID)

### Expected Results:
- ✅ QR code contains a UUID format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- ✅ No additional data in QR code
- ✅ UUID matches the booking ID

### Test Invalid QR:
1. Try to validate an invalid QR code (non-UUID)
2. Use internal scanner in reception page

### Expected Results:
- ✅ Error message: "Invalid booking ID format"
- ✅ Invalid QR codes are rejected

---

## TASK 3: External vs Internal QR Scanner ✅

### External Scanner (Public - Read-Only)

#### Test Steps:
1. Navigate to: `/{tenantSlug}/qr` (e.g., `/tour/qr`)
2. Scan a QR code or enter booking ID manually
3. View booking details

### Expected Results:
- ✅ No login required
- ✅ Booking details displayed (read-only)
- ✅ No buttons to modify booking
- ✅ No "Validate" or "Scan QR" buttons
- ✅ Shows booking status, customer info, service, date/time

### Internal Scanner (Auth Required - Modifies State)

#### Test Steps:
1. Login as cashier or receptionist
2. Navigate to reception page: `/{tenantSlug}/reception`
3. Click "Scan QR" button
4. Scan a QR code
5. Verify booking is marked as scanned

### Expected Results:
- ✅ Login required
- ✅ QR scanner opens with camera
- ✅ After scanning, booking is marked as `qr_scanned: true`
- ✅ Booking status changes to `checked_in`
- ✅ Shows success message
- ✅ Booking list updates

---

## TASK 4: Camera API QR Scanner 📱

### Test Steps:
1. Login as cashier or receptionist
2. Navigate to reception page
3. Click "Scan QR" button
4. Grant camera permission when prompted
5. Point camera at QR code
6. Wait for scan to complete

### Expected Results:
- ✅ Camera permission prompt appears
- ✅ Camera view opens in modal
- ✅ QR code is detected automatically
- ✅ Booking details appear after scan
- ✅ Manual input fallback is available

### Test Camera Permission Denial:
1. Deny camera permission
2. Verify error message appears
3. Verify manual input is still available

### Expected Results:
- ✅ Error message: "Camera permission denied"
- ✅ Manual input field is available
- ✅ Can still enter booking ID manually

### Test No Camera Available:
1. Use device without camera (or disable camera)
2. Verify graceful handling

### Expected Results:
- ✅ Error message: "No camera found"
- ✅ Manual input is available
- ✅ App doesn't crash

---

## TASK 6: Auto-fill by Phone Number ✅

### Test Scenario 1: Customer Exists - Empty Fields
1. Open reception page
2. Start creating new booking
3. Leave customer name and email empty
4. Enter phone number of existing customer
5. Wait for lookup to complete

### Expected Results:
- ✅ Customer name auto-fills
- ✅ Customer email auto-fills (if available)
- ✅ Loading indicator appears during lookup

### Test Scenario 2: Customer Exists - Fields Already Filled
1. Open reception page
2. Start creating new booking
3. **Manually enter** customer name: "John Doe"
4. Enter phone number of existing customer (different name in database)
5. Wait for lookup to complete

### Expected Results:
- ✅ Customer name stays as "John Doe" (NOT overwritten)
- ✅ Customer email auto-fills (if field was empty)
- ✅ User-entered data is preserved

### Test Scenario 3: Customer Not Found
1. Open reception page
2. Start creating new booking
3. Enter phone number that doesn't exist
4. Wait for lookup to complete

### Expected Results:
- ✅ No error message (graceful handling)
- ✅ Form fields remain as user entered them
- ✅ Form is NOT cleared
- ✅ Can continue entering booking details

### Test Scenario 4: Guest Booking (No Customer Record)
1. Enter phone number from a previous guest booking
2. Verify auto-fill from booking history

### Expected Results:
- ✅ If guest booking exists, name/email auto-fills
- ✅ Only fills if fields are empty
- ✅ Doesn't overwrite user input

---

## Test Checklist

### Quick Verification:
- [ ] Railway backend: Check Network tab, all requests to Railway
- [ ] QR structure: Scan QR code, verify UUID format
- [ ] External scanner: Visit `/{tenantSlug}/qr`, scan QR, view details
- [ ] Internal scanner: Login, scan QR, verify state change
- [ ] Camera scanner: Test camera permission and scanning
- [ ] Auto-fill: Test with existing customer, verify no overwrite

### Detailed Testing:
- [ ] Test all error scenarios
- [ ] Test on different browsers
- [ ] Test on mobile device (camera)
- [ ] Test with different user roles
- [ ] Test edge cases (empty data, invalid formats)

---

## Known Issues / Notes

1. **Camera Testing**: Requires actual device with camera
2. **QR Code Testing**: Need actual booking tickets with QR codes
3. **Auto-fill Testing**: Requires existing customer data in database

---

## Reporting Issues

If you find any issues during testing:
1. Note the task number (TASK 1-6)
2. Describe the steps to reproduce
3. Include expected vs actual behavior
4. Include browser/device information
5. Include any console errors
