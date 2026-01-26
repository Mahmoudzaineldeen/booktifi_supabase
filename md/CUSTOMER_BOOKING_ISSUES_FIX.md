# Customer Booking Issues - Fix Guide

## Issues Reported

1. ✅ **WhatsApp Ticket**: Received (working)
2. ❌ **Email Ticket**: Not received
3. ❌ **Invoice**: Not received (not created)

## Root Causes

### Issue 1: Invoice Not Created

**Problem**: Invoices are only created when `payment_status = 'paid'`

**Current Status**: All customer bookings have `payment_status = 'unpaid'` by default

**Solution**: 
- Invoices are automatically created when payment is confirmed
- The database trigger queues invoice creation when `payment_status` changes to `'paid'`
- For testing, you can manually update payment status

### Issue 2: Email Ticket Not Received

**Possible Causes**:
1. Email sending failed silently (check server logs)
2. Email went to spam folder
3. SMTP configuration issue
4. Email address typo

**SMTP Configuration**: ✅ Configured
- SMTP_HOST: smtp.gmail.com
- SMTP_PORT: 587
- SMTP_USER: SET
- SMTP_PASSWORD: SET

## Solutions

### Solution 1: Check Server Logs for Email Errors

Check the server console/logs when a booking is created. Look for:
- `📧 Step 3: Attempting to send ticket via Email...`
- `✅ Step 3 Complete: Ticket PDF sent via Email`
- Or error messages

### Solution 2: Manually Send Ticket via Email

Use the API to manually send the ticket:

```bash
# Get your booking ID first
cd project/server
node scripts/check-customer-booking.js your-email@example.com
```

Then use the booking creation endpoint which should send the email, or check server logs.

### Solution 3: Create Invoice for Existing Booking

To create an invoice for an unpaid booking (for testing):

**Option A: Update Payment Status via API**

```bash
# Update payment status to 'paid' (triggers invoice creation)
curl -X PATCH http://localhost:3001/api/bookings/YOUR_BOOKING_ID/payment-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"payment_status": "paid"}'
```

**Option B: Use Script**

```bash
cd project/server
node scripts/update-payment-and-create-invoice.js YOUR_BOOKING_ID
```

### Solution 4: Check Email in Spam Folder

Sometimes emails go to spam. Check:
- Spam/Junk folder
- Promotions tab (Gmail)
- All Mail folder

## How It Should Work

### Normal Flow (Customer Books)

1. **Customer creates booking** → `payment_status = 'unpaid'`
2. **Ticket sent via WhatsApp** ✅ (working)
3. **Ticket sent via Email** ❌ (needs investigation)
4. **Invoice NOT created** (because payment is unpaid)

### After Payment Confirmed

1. **Payment status updated to 'paid'** (via payment gateway or manual update)
2. **Database trigger fires** → Queues Zoho invoice job
3. **Zoho worker processes job** → Creates invoice in Zoho
4. **Invoice sent via Zoho** → Email sent to customer

## Testing Steps

### Test 1: Check Email Sending

1. Create a test booking
2. Check server logs for email sending
3. Check spam folder
4. Verify SMTP credentials are correct

### Test 2: Create Invoice

1. Find a booking ID:
   ```bash
   node scripts/check-customer-booking.js
   ```

2. Update payment status:
   ```bash
   # Use API or script to set payment_status = 'paid'
   ```

3. Check invoice creation:
   ```bash
   node scripts/check-customer-booking.js
   # Should show zoho_invoice_id
   ```

## Quick Fixes

### Fix 1: Send Ticket Email for Existing Booking

The ticket email should be sent automatically when booking is created. If it wasn't sent:

1. Check server logs for errors
2. Verify email address is correct
3. Check SMTP configuration
4. Try resending manually (may need to implement resend endpoint)

### Fix 2: Create Invoice for Unpaid Booking

For testing purposes, you can manually create an invoice:

```bash
cd project/server
node scripts/create-invoice-simple-api.js
# But this requires payment_status = 'paid'
```

Or update payment status first, then invoice will be created automatically.

## Recommendations

1. **For Production**: 
   - Invoices should only be created when payment is confirmed
   - Current behavior is correct (no invoice for unpaid bookings)

2. **For Testing**:
   - You can manually update payment status to test invoice creation
   - Or create bookings with `payment_status = 'paid'` initially

3. **Email Issues**:
   - Check server logs when booking is created
   - Verify SMTP credentials
   - Test email sending separately
   - Check spam folders

## Next Steps

1. ✅ Check server logs for email sending errors
2. ✅ Verify SMTP configuration
3. ✅ Test email sending manually
4. ✅ Update payment status to trigger invoice creation
5. ✅ Verify invoice is created and sent

