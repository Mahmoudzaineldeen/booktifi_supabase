# Manual QR Ticket Generation and Scanning Test

## ✅ Automated Tests Passed

The automated tests confirm that:
- ✅ Booking ID extraction works for URL format (Bolt and Railway)
- ✅ Booking ID extraction works for UUID format
- ✅ External scanner can display booking details
- ✅ Internal scanner can validate QR codes
- ✅ Both URL and UUID formats are supported

## Manual Testing Steps

### Step 1: Create a New Booking

1. **Sign in as Receptionist**:
   - Email: `receptionist1@bookati.local` (or your receptionist account)
   - Password: `111111`
   - Navigate to: `/{tenant-slug}/reception`

2. **Create a Booking**:
   - Click "New Booking"
   - Fill in customer details
   - Select a service and time slot
   - Complete the booking

3. **Wait for Ticket Generation**:
   - Ticket PDF is generated asynchronously
   - Wait 5-10 seconds after booking creation
   - Check customer email/WhatsApp for ticket

### Step 2: Verify QR Code in Ticket PDF

1. **Open the Ticket PDF**:
   - Download from email or WhatsApp
   - Open in PDF viewer

2. **Check QR Code Content**:
   - Scan the QR code with a QR code reader app
   - **Expected**: Should contain a URL like:
     ```
     https://booktifisupabase-production.up.railway.app/api/bookings/{booking-id}/details
     ```
   - **If you see Bolt URL**: `APP_URL` in Railway needs to be updated

3. **Verify QR Code Format**:
   - QR should contain a full URL (not just UUID)
   - URL should point to Railway backend (not Bolt)

### Step 3: Test External QR Scanner

1. **Scan with Phone Camera**:
   - Open phone camera
   - Point at QR code in ticket PDF
   - Camera should detect QR code
   - Tap the notification to open URL

2. **Verify Display**:
   - Browser should open
   - Should display booking details page with:
     - ✅ EVENT DETAILS
     - ✅ DATE & TIME
     - ✅ TICKET TYPE
     - ✅ CUSTOMER NAME
     - ✅ PRICE
   - Should be formatted and readable

3. **Test with Other Scanners**:
   - WhatsApp QR scanner
   - Third-party QR reader apps
   - All should open the URL and display booking details

### Step 4: Test Internal QR Scanner (Cashier)

1. **Sign in as Cashier**:
   - Email: `cash@gmail.com`
   - Password: `111111`
   - Navigate to: `/{tenant-slug}/cashier`

2. **Scan QR Code**:
   - Click "Open QR Scanner"
   - Point camera at QR code in ticket PDF
   - Or manually enter the URL from QR code

3. **Verify Validation**:
   - Should extract booking ID from URL
   - Should validate booking successfully
   - Should display booking details:
     - Customer name
     - Service name
     - Date & time
     - Payment status
   - Should show "Mark as Paid" button if unpaid

4. **Test with Raw UUID**:
   - Manually enter just the booking ID (UUID)
   - Should also validate correctly
   - Confirms backward compatibility

### Step 5: Verify QR Status

1. **After Scanning**:
   - Booking should be marked as `checked_in`
   - QR should be marked as scanned
   - Should show scan timestamp

2. **Try Scanning Again**:
   - Scan the same QR code again
   - Should show "QR code has already been scanned"
   - Should display original scan timestamp

## Expected Results

### ✅ Success Criteria

1. **QR Code Generation**:
   - ✅ QR code contains Railway URL (not Bolt URL)
   - ✅ URL format: `https://railway-url/api/bookings/{uuid}/details`
   - ✅ QR code is scannable and readable

2. **External Scanner**:
   - ✅ Opens URL in browser
   - ✅ Displays formatted booking details
   - ✅ Shows all required information
   - ✅ Read-only (no validation)

3. **Internal Scanner**:
   - ✅ Extracts booking ID from URL
   - ✅ Validates booking successfully
   - ✅ Displays full booking details
   - ✅ Shows QR status
   - ✅ Allows payment status update

4. **Backward Compatibility**:
   - ✅ Old QR codes (Bolt URL) still work
   - ✅ Raw UUID format still works
   - ✅ No "Invalid booking ID format" errors

## Troubleshooting

### Issue: QR Code Contains Bolt URL

**Solution**: Update `APP_URL` in Railway:
1. Go to Railway Dashboard
2. Select your backend service
3. Go to Variables tab
4. Update `APP_URL` to: `https://booktifisupabase-production.up.railway.app`
5. Redeploy service

### Issue: "Invalid booking ID format" Error

**Possible Causes**:
- QR code is corrupted or damaged
- QR code contains invalid data
- Booking ID format is incorrect

**Solution**:
- Verify QR code is scannable
- Check Railway logs for QR generation
- Ensure booking ID is valid UUID

### Issue: External Scanner Shows Raw UUID

**Possible Causes**:
- `APP_URL` not set in Railway
- QR code generation failed
- Fallback to UUID-only format

**Solution**:
- Set `APP_URL` in Railway
- Check Railway logs for QR generation errors
- Verify environment variables

### Issue: Internal Scanner Cannot Validate

**Possible Causes**:
- Cashier not signed in
- Booking doesn't exist
- Booking belongs to different tenant
- QR already scanned

**Solution**:
- Verify cashier is signed in
- Check booking exists in database
- Verify tenant ownership
- Check if QR was already scanned

## Test Results Template

```
Test Date: ___________
Tester: ___________

✅ QR Code Generation:
   - URL Format: [ ] Correct [ ] Incorrect
   - Contains Railway URL: [ ] Yes [ ] No
   - Scannable: [ ] Yes [ ] No

✅ External Scanner:
   - Opens URL: [ ] Yes [ ] No
   - Displays Details: [ ] Yes [ ] No
   - Formatting: [ ] Good [ ] Poor

✅ Internal Scanner:
   - Extracts ID: [ ] Yes [ ] No
   - Validates: [ ] Yes [ ] No
   - Shows Details: [ ] Yes [ ] No
   - Payment Update: [ ] Works [ ] Fails

✅ Backward Compatibility:
   - Old QR Codes Work: [ ] Yes [ ] No
   - UUID Format Works: [ ] Yes [ ] No

Notes:
_______________________________________
_______________________________________
```

## Next Steps After Testing

1. **If All Tests Pass**:
   - ✅ QR ticket generation and scanning is working correctly
   - ✅ Update `APP_URL` in Railway to ensure new QR codes use Railway URL
   - ✅ Monitor for any issues in production

2. **If Tests Fail**:
   - Check Railway logs for errors
   - Verify environment variables are set correctly
   - Test with a fresh booking
   - Contact support if issues persist
