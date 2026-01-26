# Email Delivery Testing Guide

## 🧪 Test Scripts Created

Three comprehensive test scripts have been created to diagnose and fix email delivery issues:

### 1. **Comprehensive Test Suite** (`test-invoice-email-delivery.js`)
Tests all aspects of invoice email delivery:
- Recent bookings with emails
- Invoice creation status
- Email extraction
- Zoho token status
- Zoho configuration
- Actual invoice generation

### 2. **Diagnostic Tool** (`diagnose-email-delivery.js`)
Quick diagnostic that checks:
- Email format validation
- Invoice existence
- Zoho token status
- Zoho configuration
- Email extraction
- Actual email sending test

### 3. **Quick Test** (`quick-email-test.js`)
Fast test for a specific booking:
- Tests email delivery for one booking
- Creates invoice if needed
- Sends test email

---

## 🚀 How to Run Tests

### Test 1: Comprehensive Test Suite

```bash
cd "E:\New folder\sauidi tower\project\server"
node scripts/test-invoice-email-delivery.js
```

**What it does**:
- Finds recent bookings with emails
- Creates test booking if none found
- Tests all email delivery components
- Generates actual invoice and sends email

**Output**: Detailed report of all test scenarios

---

### Test 2: Diagnostic Tool

```bash
cd "E:\New folder\sauidi tower\project\server"
node scripts/diagnose-email-delivery.js
```

**What it does**:
- Finds a booking with email
- Checks all prerequisites
- Tests actual email sending
- Provides summary of issues

**Output**: Diagnostic report with issues found

---

### Test 3: Quick Test (Specific Booking)

```bash
cd "E:\New folder\sauidi tower\project\server"
node scripts/quick-email-test.js <booking-id>
```

**Example**:
```bash
node scripts/quick-email-test.js abc123-def456-ghi789
```

**What it does**:
- Tests email for specific booking
- Creates invoice if needed
- Sends test email
- Shows success/failure

**Output**: Quick test results

---

## 📊 What to Look For

### ✅ Success Indicators

1. **Email Found**:
   ```
   ✅ Email found in booking: "customer@example.com"
   ```

2. **Email Valid**:
   ```
   Valid format: ✅ YES
   ```

3. **Email Sent**:
   ```
   ✅ Invoice sent via email to customer@example.com
   ```

4. **Database Logged**:
   ```
   ✅ Email delivery logged to database
   ```

### ❌ Failure Indicators

1. **No Email**:
   ```
   ⚠️ No customer email provided
   ```

2. **Invalid Format**:
   ```
   ❌ Invalid email format: "invalid-email"
   ```

3. **Email Send Failed**:
   ```
   ❌ Failed to send invoice email: [error message]
   ```

4. **No Invoice**:
   ```
   Invoice ID: ❌ NOT CREATED
   ```

5. **No Zoho Token**:
   ```
   Token Status: ❌ NOT FOUND
   ```

---

## 🔍 Common Issues and Fixes

### Issue 1: "No customer email provided"

**Check**:
```sql
SELECT customer_email FROM bookings WHERE id = 'booking-id';
```

**Fix**:
- Ensure booking has `customer_email` when created
- Check booking creation code includes email

---

### Issue 2: "Invalid email format"

**Check**: Email format in database
```sql
SELECT customer_email FROM bookings WHERE id = 'booking-id';
```

**Fix**:
- Ensure email is properly formatted
- Check for extra spaces or invalid characters

---

### Issue 3: "Zoho token not found"

**Check**:
```sql
SELECT * FROM zoho_tokens WHERE tenant_id = 'tenant-id';
```

**Fix**:
- Connect to Zoho via Settings page
- Complete OAuth flow

---

### Issue 4: "Email sending failed: 1025"

**Error**: Mobile number not verified

**Fix**:
1. Go to https://accounts.zoho.com/
2. Security → Mobile Number
3. Verify mobile number
4. Retry email sending

---

### Issue 5: "Invoice not created"

**Check**:
```sql
SELECT zoho_invoice_id FROM bookings WHERE id = 'booking-id';
```

**Fix**:
- Invoice must be created before email can be sent
- Check Zoho connection status
- Check Zoho API logs

---

## 📝 Step-by-Step Debugging

### Step 1: Run Diagnostic Tool

```bash
node scripts/diagnose-email-delivery.js
```

**Review output** for any ❌ indicators

### Step 2: Check Server Logs

Look for these log sections:
```
[ZohoService] ========================================
[ZohoService] EMAIL DELIVERY PROCESS STARTING
[ZohoService] ========================================
[ZohoService] 🔍 Email extraction debug:
   booking.customer_email (raw): ...
   Email (final): ...
[ZohoService] 📧 Attempting to send invoice via email...
```

### Step 3: Check Database Logs

```sql
SELECT 
  booking_id,
  zoho_invoice_id,
  status,
  error_message,
  created_at
FROM zoho_invoice_logs
WHERE status IN ('email_sent', 'email_failed')
ORDER BY created_at DESC
LIMIT 10;
```

### Step 4: Test Specific Booking

```bash
node scripts/quick-email-test.js <booking-id>
```

### Step 5: Check Zoho Invoice Dashboard

1. Log in to Zoho Invoice
2. Go to Invoices
3. Find invoice by ID
4. Check "Email Sent" status
5. View email logs

---

## 🎯 Expected Test Results

### ✅ All Tests Pass

```
✅ Check 1: Email Format Validation
   Valid Format: ✅ YES

✅ Check 2: Invoice Creation Status
   Invoice ID: abc123 ✅

✅ Check 3: Zoho Token Status
   Token Status: ✅ ACTIVE

✅ Check 4: Zoho Configuration
   Client ID: ✅ Set

✅ Check 5: Email Extraction Test
   Email found: ✅ YES

✅ Check 6: Test Email Sending
   ✅ Email sent successfully!
```

### ❌ Issues Found

```
❌ Issues found:

   ❌ Email format is invalid
   ❌ Invoice not created
   ❌ Zoho tokens not found
```

---

## 🔧 Fixing Issues

### If Email Not Found

1. Check booking creation:
   ```sql
   SELECT customer_email FROM bookings WHERE id = 'booking-id';
   ```

2. Update booking if needed:
   ```sql
   UPDATE bookings 
   SET customer_email = 'customer@example.com'
   WHERE id = 'booking-id';
   ```

3. Re-run invoice generation:
   ```bash
   node scripts/quick-email-test.js <booking-id>
   ```

### If Invoice Not Created

1. Check Zoho connection:
   - Go to Settings → Zoho Invoice Integration
   - Verify "Connected" status

2. Check Zoho tokens:
   ```sql
   SELECT * FROM zoho_tokens WHERE tenant_id = 'tenant-id';
   ```

3. Reconnect if needed:
   - Click "Connect to Zoho" in Settings

### If Email Sending Fails

1. Check error message in logs
2. Verify Zoho account mobile number
3. Check Zoho API status
4. Review error details in database logs

---

## 📋 Test Checklist

Before testing, ensure:
- [ ] Server is running
- [ ] Database is accessible
- [ ] Zoho is connected (check Settings page)
- [ ] At least one booking with email exists
- [ ] Zoho tokens are valid

---

## 🎉 Success Criteria

After running tests, you should see:
- ✅ Email extracted from booking
- ✅ Email format validated
- ✅ Invoice created (if not exists)
- ✅ Email sent successfully
- ✅ Email delivery logged to database
- ✅ Customer receives email

---

**Next Steps**: Run the diagnostic tool to identify specific issues!

