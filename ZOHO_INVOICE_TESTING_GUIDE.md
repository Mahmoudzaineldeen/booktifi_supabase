# Zoho Invoice Creation Testing Guide

## ✅ Implementation Status

The Zoho invoice creation system has been fully implemented with:

1. **Comprehensive Precondition Verification**
   - Zoho configuration check
   - OAuth token validation
   - Customer contact verification
   - Clear error messages

2. **5-Step Invoice Creation Flow**
   - Step 1: Create invoice in Zoho API
   - Step 2: Persist invoice data to database
   - Step 3: Log success to zoho_invoice_logs
   - Step 4: Verify invoice exists in Zoho
   - Step 5: Final verification of booking-invoice link

3. **Duplicate Prevention**
   - Checks for existing invoices before creation
   - Verifies existing invoices in Zoho

4. **Error Handling**
   - Structured error responses
   - Comprehensive error logging
   - Non-blocking (booking succeeds even if invoice fails)

5. **Delivery System**
   - Email delivery via Zoho API
   - WhatsApp delivery (PDF download + send)
   - Delivery status logging

## 🧪 Manual Testing Instructions

### Prerequisites

1. **Zoho Integration Configured**
   - Go to Settings → Zoho Integration
   - Ensure Zoho credentials are set (client_id, client_secret, redirect_uri)
   - Complete OAuth flow (Connect to Zoho)
   - Verify connection status shows "Connected"

2. **Customer Contact Information**
   - Ensure booking has either:
     - Customer email (for email delivery)
     - Customer phone (for WhatsApp delivery)
     - Or both

3. **Service and Slot Available**
   - Ensure at least one service exists
   - Ensure at least one slot is available for booking

### Test Steps

#### Step 1: Login as Receptionist

1. Navigate to: `http://localhost:5173/login` (or your production URL)
2. Login with:
   - **Email/Username**: `receptionist1`
   - **Password**: `111111`
3. You should be redirected to the Reception page

#### Step 2: Create a Booking

1. On the Reception page, click "Create Booking" or "New Booking"
2. Fill in the booking form:
   - **Service**: Select any available service
   - **Date & Time**: Select an available slot
   - **Customer Name**: `Test Customer - Invoice Test`
   - **Customer Email**: `test-customer@example.com` (or use a real email to test delivery)
   - **Customer Phone**: `+966501234567` (or any valid phone number)
   - **Adults**: 2
   - **Children**: 0
   - **Notes**: `Test booking for Zoho invoice verification`
3. Click "Create Booking" or "Save"

#### Step 3: Verify Booking Created

1. The booking should appear in the bookings list
2. Note the **Booking ID** (you'll need this for verification)

#### Step 4: Wait for Invoice Creation

1. Wait 5-30 seconds for invoice creation to complete
2. The invoice creation happens asynchronously after booking creation
3. Check server logs for invoice creation status

#### Step 5: Verify Invoice in Database

1. Check the booking details - it should show:
   - `zoho_invoice_id` (the Zoho invoice ID)
   - `zoho_invoice_created_at` (timestamp)

2. You can verify this by:
   - Viewing the booking in the Reception page
   - Or querying the database directly:
     ```sql
     SELECT id, zoho_invoice_id, zoho_invoice_created_at, customer_name, total_price
     FROM bookings
     WHERE id = '<your-booking-id>';
     ```

#### Step 6: Verify Invoice in Zoho

1. Log in to your Zoho Invoice account
2. Navigate to Invoices
3. Search for the invoice using:
   - Invoice ID (from `zoho_invoice_id` in booking)
   - Customer name: `Test Customer - Invoice Test`
   - Date: Today's date

4. Verify:
   - Invoice exists
   - Invoice amount matches booking total
   - Invoice currency matches tenant currency
   - Customer details match booking
   - Invoice status is "sent" (not draft)

#### Step 7: Verify Invoice Delivery

1. **Email Delivery**:
   - Check the customer's email inbox (test-customer@example.com)
   - Look for email from Zoho Invoice
   - Email should contain invoice link or PDF attachment

2. **WhatsApp Delivery** (if phone provided):
   - Check the customer's WhatsApp
   - Should receive invoice PDF document
   - Message: "Your booking invoice is attached. Thank you for your booking!"

3. **Check Server Logs**:
   - Look for `[ZohoService] ✅ Invoice sent via email`
   - Look for `[ZohoService] ✅ Invoice PDF sent via WhatsApp`
   - Check `zoho_invoice_logs` table for delivery status

## 📊 Verification Checklist

Use this checklist to verify the complete flow:

- [ ] Booking created successfully
- [ ] Booking has `zoho_invoice_id` in database
- [ ] Booking has `zoho_invoice_created_at` timestamp
- [ ] Invoice exists in Zoho Invoice dashboard
- [ ] Invoice amount matches booking total
- [ ] Invoice currency matches tenant currency
- [ ] Customer details match booking
- [ ] Invoice status is "sent" (not draft)
- [ ] Email sent to customer (if email provided)
- [ ] WhatsApp message sent (if phone provided)
- [ ] Invoice logs created in `zoho_invoice_logs` table

## 🔍 Troubleshooting

### Invoice Not Created

**Check:**
1. Zoho configuration exists and is active
2. Zoho OAuth token is not expired
3. Customer has email or phone
4. Server logs for error messages

**Common Errors:**
- `Zoho Invoice not configured` → Configure Zoho in Settings
- `Zoho token expired` → Reconnect Zoho in Settings
- `No customer contact` → Add email or phone to booking

### Invoice Created But Not Sent

**Check:**
1. Customer email format is valid
2. Customer phone number is valid
3. SMTP settings configured (for email)
4. WhatsApp settings configured (for WhatsApp)
5. Server logs for delivery errors

**Common Errors:**
- `Invalid email format` → Check email address
- `Mobile number not verified` → Verify Zoho account mobile number
- `SMTP timeout` → Check SMTP settings

### Invoice Not Linked to Booking

**Check:**
1. Server logs for database update errors
2. `zoho_invoice_logs` table for `partial_success` status
3. Manual linking may be required if DB update failed

## 📝 Server Logs to Monitor

When creating a booking, you should see these log messages:

```
[Booking Creation] 🧾 Invoice Flow Started for booking <booking-id>
[Booking Creation] ✅ Zoho is configured and connected for tenant <tenant-id>
[ZohoService] 🔒 Verifying preconditions for invoice creation...
[ZohoService] ✅ All preconditions verified - proceeding with invoice creation
[ZohoService] 📋 Step 1: Creating invoice in Zoho Invoice...
[ZohoService] ✅ Step 1 Complete: Invoice created in Zoho
[ZohoService] 💾 Step 2: Saving invoice data to database...
[ZohoService] ✅ Step 2 Complete: Invoice data saved to database
[ZohoService] 🔍 Step 4: Verifying invoice exists in Zoho...
[ZohoService] ✅ Step 4 Complete: Invoice verified in Zoho
[ZohoService] 📧 Attempting to send invoice via email...
[ZohoService] ✅ Invoice sent via email to <email>
[ZohoService] ✅ RECEIPT GENERATION COMPLETE
```

## 🎯 Expected Results

After completing the test:

1. **Booking**: Created successfully with all details
2. **Zoho Invoice**: Created once (no duplicates)
3. **Invoice Linked**: `zoho_invoice_id` saved in booking
4. **Invoice Sent**: Email and/or WhatsApp sent to customer
5. **Errors Logged**: Any failures logged to `zoho_invoice_logs`
6. **No Duplicates**: Only one invoice per booking

## 📞 Support

If you encounter issues:

1. Check server logs for detailed error messages
2. Verify Zoho configuration in Settings
3. Check `zoho_invoice_logs` table for error details
4. Ensure customer contact information is valid
5. Verify Zoho OAuth token is not expired

---

**Last Updated**: 2026-01-24
**Implementation Status**: ✅ Complete
**Test Status**: Ready for Manual Testing
