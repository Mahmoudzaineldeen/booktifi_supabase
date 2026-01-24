# Zoho Invoice Creation Debug Guide

## Problem
No Zoho invoices are being generated when creating bookings through the receptionist interface.

## Enhanced Logging Added

I've added comprehensive logging throughout the invoice creation flow. When you create a booking, you should now see these logs in sequence:

### 1. Initial Check (Synchronous - Always Logged)
```
[Booking Creation] ========================================
[Booking Creation] 🧾 INVOICE CREATION CHECK
[Booking Creation] ========================================
[Booking Creation]    Booking ID: <booking-id>
[Booking Creation]    Tenant ID: <tenant-id>
[Booking Creation]    Customer Email: <email> or NOT PROVIDED
[Booking Creation]    Customer Phone: <phone> or NOT PROVIDED
[Booking Creation]    Has Email: true/false
[Booking Creation]    Has Phone: true/false
[Booking Creation]    Will Create Invoice: true/false
[Booking Creation] ========================================
```

### 2. If Contact Available
```
[Booking Creation] ✅ Customer contact available - proceeding with invoice creation
[Booking Creation] ✅ Invoice creation promise created and queued
```

### 3. Invoice Flow Started (Inside Promise)
```
[Booking Creation] ========================================
[Booking Creation] 🧾 INVOICE FLOW STARTED
[Booking Creation] ========================================
[Booking Creation]    Booking ID: <booking-id>
[Booking Creation]    Tenant ID: <tenant-id>
[Booking Creation]    Customer Email: <email> or NOT PROVIDED
[Booking Creation]    Customer Phone: <phone> or NOT PROVIDED
[Booking Creation]    Flow: Booking Confirmed → Create Invoice → Send via Email/WhatsApp
[Booking Creation] ========================================
```

### 4. Zoho Configuration Check
```
[Booking Creation] 🔍 Step 1: Checking Zoho configuration...
[Booking Creation] 🔍 Step 2: Checking Zoho tokens...
[Booking Creation] 📊 Configuration Check Results:
[Booking Creation]    Zoho Config exists: true/false
[Booking Creation]    Zoho Config active: true/false
[Booking Creation]    Zoho Config has client_id: true/false
[Booking Creation]    Zoho Token exists: true/false
```

### 5. Possible Outcomes

#### A. Zoho Not Configured
```
[Booking Creation] ❌ Zoho Invoice not configured for tenant <tenant-id>
[Booking Creation]    Config exists: true/false, Token exists: true/false
[Booking Creation]    Config error: <error> or None
[Booking Creation]    Token error: <error> or None
[Booking Creation]    Invoice creation skipped. Please configure Zoho Invoice in Settings → Zoho Integration
```

#### B. Token Expired
```
[Booking Creation] 🔍 Step 3: Checking token expiration...
[Booking Creation]    Token expires at: <timestamp>
[Booking Creation]    Current time: <timestamp>
[Booking Creation]    Time until expiration: <minutes> minutes
[Booking Creation] ❌ Zoho token expired for tenant <tenant-id>
[Booking Creation]    Invoice creation skipped. Please refresh Zoho connection in Settings
```

#### C. Invoice Creation Success
```
[Booking Creation] ✅ Zoho is configured and connected for tenant <tenant-id>
[Booking Creation] 🔍 Step 4: Importing ZohoService...
[Booking Creation] ✅ ZohoService imported successfully
[Booking Creation] 🔍 Step 5: Calling zohoService.generateReceipt(<booking-id>)...
[Booking Creation] ⏱️ Invoice generation took <ms>ms
[Booking Creation] ========================================
[Booking Creation] ✅ INVOICE CREATED SUCCESSFULLY
[Booking Creation] ========================================
[Booking Creation]    Invoice ID: <invoice-id>
[Booking Creation]    Booking ID: <booking-id>
[Booking Creation]    Email delivery: WILL ATTEMPT or SKIPPED (no email)
[Booking Creation]    WhatsApp delivery: WILL ATTEMPT or SKIPPED (no phone)
[Booking Creation] ========================================
```

#### D. Invoice Creation Failed
```
[Booking Creation] ========================================
[Booking Creation] ❌ INVOICE CREATION FAILED
[Booking Creation] ========================================
[Booking Creation]    Booking ID: <booking-id>
[Booking Creation]    Error: <error-message>
[Booking Creation]    This may be due to Zoho connection issues. Check server logs for details.
[Booking Creation] ========================================
```

#### E. Exception in Invoice Creation
```
[Booking Creation] ========================================
[Booking Creation] ❌ EXCEPTION IN INVOICE CREATION
[Booking Creation] ========================================
[Booking Creation]    Booking ID: <booking-id>
[Booking Creation]    Error Type: <ErrorType>
[Booking Creation]    Error Message: <error-message>
[Booking Creation]    Error Code: <code> or N/A
[Booking Creation]    Error Stack: <stack-trace>
[Booking Creation]    Category: Zoho Configuration Missing or Unexpected Error
[Booking Creation] ========================================
```

#### F. Promise Rejection (Unhandled)
```
[Booking Creation] ❌ CRITICAL: Unhandled error in invoice generation promise
[Booking Creation]    Error Type: <ErrorType>
[Booking Creation]    Error Message: <error-message>
[Booking Creation]    Error Stack: <stack-trace>
```

## Debugging Steps

### Step 1: Check Initial Logs
When you create a booking, look for:
- `[Booking Creation] 🧾 INVOICE CREATION CHECK` - This should ALWAYS appear
- Check if `Will Create Invoice: true` or `false`
- If `false`, check why (no email/phone?)

### Step 2: Check Contact Information
If `Will Create Invoice: false`:
- Verify booking has customer email OR phone
- Check the booking form is sending email/phone correctly

### Step 3: Check Zoho Configuration
If `Will Create Invoice: true` but no invoice:
- Look for `[Booking Creation] 🔍 Step 1: Checking Zoho configuration...`
- Check the configuration results
- Verify Zoho is configured in Settings → Zoho Integration

### Step 4: Check Token Status
- Look for token expiration warnings
- Verify token is not expired
- Check if token exists in database

### Step 5: Check ZohoService Logs
If configuration is OK, look for:
- `[ZohoService] 🔒 Verifying preconditions...`
- `[ZohoService] ✅ All preconditions verified...`
- `[ZohoService] 📋 Step 1: Creating invoice...`

### Step 6: Check for Errors
Look for any error messages:
- Configuration errors
- Token errors
- API errors
- Database errors
- Currency/language errors

## Common Issues & Solutions

### Issue 1: No Logs Appearing
**Possible Causes**:
- Logs are being filtered by Railway
- Promise is not executing
- Booking creation is failing before invoice flow

**Solution**:
- Check Railway logs with full verbosity
- Look for `[Booking Creation] ✅ BOOKING CREATED SUCCESSFULLY` to confirm booking was created
- Check if promise is being created: `[Booking Creation] ✅ Invoice creation promise created and queued`

### Issue 2: "Will Create Invoice: false"
**Possible Causes**:
- No customer email provided
- No customer phone provided
- Email/phone fields are empty strings

**Solution**:
- Verify booking form includes email or phone
- Check database to see if booking has email/phone
- Ensure form validation allows empty email if phone is provided

### Issue 3: "Zoho Invoice not configured"
**Possible Causes**:
- `tenant_zoho_configs` table missing or empty
- `zoho_tokens` table missing or empty
- Config is not active (`is_active = false`)

**Solution**:
- Go to Settings → Zoho Integration
- Add Zoho credentials (client_id, client_secret, redirect_uri)
- Complete OAuth flow (Connect to Zoho)
- Verify connection status

### Issue 4: "Token expired"
**Possible Causes**:
- Zoho OAuth token has expired
- Token refresh failed

**Solution**:
- Go to Settings → Zoho Integration
- Click "Disconnect" then "Connect to Zoho" again
- Complete OAuth flow to get new token

### Issue 5: Invoice Creation Fails
**Possible Causes**:
- Currency code issues
- Service name/description issues
- Zoho API errors
- Network issues

**Solution**:
- Check `[ZohoService]` logs for specific error
- Verify currency code is valid (SAR, USD, GBP, EUR)
- Check service names are not empty
- Verify Zoho API is accessible

## Verification Commands

### Check Booking in Database
```sql
SELECT 
  id, 
  customer_name, 
  customer_email, 
  customer_phone, 
  zoho_invoice_id, 
  zoho_invoice_created_at,
  created_at
FROM bookings
WHERE id = '<booking-id>';
```

### Check Zoho Configuration
```sql
SELECT 
  id, 
  tenant_id, 
  is_active, 
  client_id, 
  redirect_uri
FROM tenant_zoho_configs
WHERE tenant_id = '<tenant-id>';
```

### Check Zoho Tokens
```sql
SELECT 
  id, 
  tenant_id, 
  expires_at,
  CASE 
    WHEN expires_at > NOW() THEN 'Valid'
    ELSE 'Expired'
  END as status
FROM zoho_tokens
WHERE tenant_id = '<tenant-id>';
```

### Check Invoice Logs
```sql
SELECT 
  id,
  booking_id,
  zoho_invoice_id,
  status,
  error_message,
  created_at
FROM zoho_invoice_logs
WHERE booking_id = '<booking-id>'
ORDER BY created_at DESC;
```

## Next Steps

1. **Create a test booking** through the receptionist interface
2. **Check Railway logs** for all `[Booking Creation]` messages
3. **Identify where the flow stops** (which log message is the last one you see)
4. **Follow the debugging steps** above based on where it stops
5. **Check database** to verify booking was created and if invoice_id exists

## Expected Log Sequence (Success Case)

1. `[Booking Creation] 🧾 INVOICE CREATION CHECK` ✅
2. `[Booking Creation] ✅ Customer contact available` ✅
3. `[Booking Creation] ✅ Invoice creation promise created` ✅
4. `[Booking Creation] 🧾 INVOICE FLOW STARTED` ✅
5. `[Booking Creation] 🔍 Step 1: Checking Zoho configuration...` ✅
6. `[Booking Creation] 🔍 Step 2: Checking Zoho tokens...` ✅
7. `[Booking Creation] 📊 Configuration Check Results:` ✅
8. `[Booking Creation] ✅ Zoho is configured and connected` ✅
9. `[Booking Creation] 🔍 Step 4: Importing ZohoService...` ✅
10. `[Booking Creation] 🔍 Step 5: Calling zohoService.generateReceipt...` ✅
11. `[ZohoService] 🔒 Verifying preconditions...` ✅
12. `[ZohoService] ✅ All preconditions verified` ✅
13. `[ZohoService] 📋 Step 1: Creating invoice...` ✅
14. `[Booking Creation] ✅ INVOICE CREATED SUCCESSFULLY` ✅

If any step is missing, that's where the issue is!

---

**Last Updated**: 2026-01-24
**Status**: Enhanced Logging Complete
**Files Modified**: `server/src/routes/bookings.ts`, `server/src/services/zohoService.ts`
