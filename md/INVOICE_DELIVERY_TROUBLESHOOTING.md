# Invoice Delivery Troubleshooting Guide

## Problem: Invoice Not Received

If customers are not receiving invoices via email, check the following:

## Common Causes

### 1. Zoho Account Mobile Number Not Verified

**Error Code:** `1025`

**Solution:**
1. Go to [Zoho Accounts](https://accounts.zoho.com/)
2. Navigate to **Security** → **Mobile Number**
3. Verify your mobile number
4. Try sending invoice again

**Error Message:**
```
Failed to send invoice email: Your Zoho account mobile number is not verified.
```

### 2. Customer Email Missing or Invalid

**Check Railway Logs for:**
```
[ZohoService] 📧 Final email to send: NOT FOUND
[ZohoService] ❌ Invalid email format: ...
```

**Solution:**
- Ensure customer email is provided when creating booking
- Verify email format is valid (e.g., `customer@example.com`)
- Check booking data in database

### 3. Invoice Created But Email Not Sent

**Check Railway Logs for:**
```
[ZohoService] ✅ Invoice created successfully
[ZohoService]    This means invoice was created but NOT sent via email!
```

**Possible Causes:**
- Customer email missing from booking
- Email format invalid
- Zoho email API error

**Solution:**
- Check Railway logs for specific error
- Verify customer email in booking record
- Manually send invoice from Zoho Invoice dashboard

### 4. Container Restart During Invoice Sending

**Symptom:** Invoice created but email never sent, container logs show restart

**Solution:**
- Code now uses `process.nextTick` instead of `setImmediate` for better reliability
- Invoice creation is logged to database for tracking
- Check `zoho_invoice_logs` table for delivery status

## How to Check Invoice Delivery Status

### 1. Check Railway Backend Logs

Look for these log messages:

**Success:**
```
[ZohoService] ✅ Invoice sent via email to customer@example.com
[ZohoService] ✅ Email delivery logged to database
```

**Failure:**
```
[ZohoService] ❌ Failed to send invoice email: [error message]
[ZohoService]    Error type: [error type]
[ZohoService]    Error details: [details]
```

### 2. Check Database Logs

Query the `zoho_invoice_logs` table:

```sql
SELECT * FROM zoho_invoice_logs 
WHERE booking_id = 'your-booking-id'
ORDER BY created_at DESC;
```

Look for:
- `status = 'email_sent'` → Email was sent successfully
- `status = 'email_failed'` → Email sending failed
- `response_payload` → Contains error details

### 3. Check Zoho Invoice Dashboard

1. Go to [Zoho Invoice](https://books.zoho.com/)
2. Navigate to **Invoices**
3. Find the invoice by ID
4. Check **Status** and **Email History**

## Manual Invoice Resend

If invoice was created but email not sent:

### Option 1: Resend from Zoho Dashboard
1. Go to Zoho Invoice → Invoices
2. Find the invoice
3. Click **Send** → **Email**
4. Enter customer email
5. Send

### Option 2: Use Backend API (if available)
```bash
POST /api/zoho/invoices/{invoiceId}/resend
```

## Prevention

### Ensure Customer Email is Always Provided

When creating bookings:
- Always collect customer email
- Validate email format before saving
- Store email in `customer_email` field

### Verify Zoho Configuration

1. **Zoho Account:**
   - Mobile number verified
   - Email sending enabled
   - Organization email configured

2. **Zoho Invoice Settings:**
   - Email templates configured
   - Sender email verified
   - SMTP settings (if using custom SMTP)

### Monitor Invoice Delivery

- Check Railway logs regularly
- Monitor `zoho_invoice_logs` table
- Set up alerts for email failures

## Debugging Steps

1. **Check Booking Data:**
   ```sql
   SELECT id, customer_email, customer_phone, zoho_invoice_id 
   FROM bookings 
   WHERE id = 'booking-id';
   ```

2. **Check Invoice Status:**
   ```sql
   SELECT * FROM zoho_invoice_logs 
   WHERE booking_id = 'booking-id';
   ```

3. **Check Railway Logs:**
   - Look for `[ZohoService]` log entries
   - Check for error messages
   - Verify email sending attempts

4. **Test Zoho Connection:**
   - Go to Settings → Zoho
   - Click "Test Connection"
   - Verify connection status

## Common Error Messages

### "Mobile number not verified"
**Fix:** Verify mobile number in Zoho Accounts → Security

### "Invalid email format"
**Fix:** Check customer email format in booking data

### "Invoice created but NOT sent via email"
**Fix:** Check if customer email exists and is valid

### "Failed to send invoice email: [Zoho API error]"
**Fix:** Check Zoho API response in logs, verify Zoho account settings

## Still Not Working?

1. **Check Railway Logs** for detailed error messages
2. **Verify Zoho Account** mobile number is verified
3. **Check Customer Email** in booking record
4. **Test Zoho Connection** in settings
5. **Manually Send** invoice from Zoho dashboard as workaround
