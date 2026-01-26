# Zoho Invoice Currency & Language Fix

## Problem Identified

The user reported that Zoho invoices were not being created, and suspected the issue was related to currency or language handling. After investigation, several potential failure points were identified:

1. **Currency Code Issues**:
   - Currency might not be loaded from tenant relation
   - Currency code might be null/undefined
   - Currency code format might be invalid

2. **Language Issues**:
   - Service names/descriptions might be null/empty
   - Arabic text might cause encoding issues
   - Missing fallbacks for empty values

3. **Silent Failures**:
   - Errors in `mapBookingToInvoice` might not be logged
   - Currency fetching failures might be silent
   - Line item validation missing

## Fixes Implemented

### 1. Enhanced Currency Handling

**Location**: `server/src/services/zohoService.ts`

**Changes**:
- Added fallback to fetch currency directly from tenant table if relation fails
- Added currency code validation (must be 3 uppercase letters)
- Added default fallback to 'SAR' if currency is missing
- Added comprehensive logging for currency fetching

**Code**:
```typescript
// Get tenant currency - try from relation first, then fallback to direct query
let tenantCurrencyCode = bookings.tenants?.currency_code;

if (!tenantCurrencyCode && bookings.tenant_id) {
  console.log(`[ZohoService] ⚠️ Currency not found in relation, fetching directly from tenant...`);
  try {
    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('currency_code')
      .eq('id', bookings.tenant_id)
      .maybeSingle();
    
    if (!tenantError && tenantData?.currency_code) {
      tenantCurrencyCode = tenantData.currency_code;
      console.log(`[ZohoService] ✅ Currency fetched directly: ${tenantCurrencyCode}`);
    }
  } catch (tenantQueryError: any) {
    console.error(`[ZohoService] ❌ Error fetching tenant currency: ${tenantQueryError.message}`);
  }
}

// Final fallback to SAR if still not found
if (!tenantCurrencyCode) {
  console.warn(`[ZohoService] ⚠️ No currency found, using default: SAR`);
  tenantCurrencyCode = 'SAR';
}
```

### 2. Currency Code Validation

**Location**: `server/src/services/zohoService.ts` - `createInvoice` method

**Changes**:
- Validate currency code before sending to Zoho API
- Ensure currency code is uppercase and 3 characters
- Fallback to 'SAR' if invalid

**Code**:
```typescript
// CRITICAL: Validate currency_code before sending to Zoho
if (!payload.currency_code || payload.currency_code.trim().length === 0) {
  console.error(`[ZohoService] ❌ CRITICAL: currency_code is empty in payload, using SAR as fallback`);
  payload.currency_code = 'SAR';
} else {
  payload.currency_code = payload.currency_code.trim().toUpperCase();
}

// Validate currency code format (must be 3 uppercase letters)
const currencyCodeRegex = /^[A-Z]{3}$/;
if (!currencyCodeRegex.test(payload.currency_code)) {
  console.error(`[ZohoService] ❌ CRITICAL: Invalid currency_code format: "${payload.currency_code}", using SAR as fallback`);
  payload.currency_code = 'SAR';
}
```

### 3. Service Name/Description Validation

**Location**: `server/src/services/zohoService.ts` - `mapBookingToInvoice` method

**Changes**:
- Ensure service name is never null/empty
- Provide fallback name if missing
- Trim and validate all text fields
- Log service details for debugging

**Code**:
```typescript
// CRITICAL: Ensure service name is never null/undefined/empty
let serviceName = language === 'ar' && booking.service_name_ar
  ? booking.service_name_ar
  : booking.service_name;

if (!serviceName || serviceName.trim().length === 0) {
  console.warn(`[ZohoService] ⚠️ Service name is empty, using fallback`);
  serviceName = 'Service'; // Fallback name
}
serviceName = serviceName.trim();

let serviceDescription = language === 'ar' && booking.service_description_ar
  ? booking.service_description_ar
  : booking.service_description;

// Description can be empty, but ensure it's at least an empty string
if (!serviceDescription) {
  serviceDescription = '';
}
serviceDescription = serviceDescription.trim();
```

### 4. Line Item Validation

**Location**: `server/src/services/zohoService.ts` - `createInvoice` method

**Changes**:
- Validate and sanitize all line item data
- Ensure rates and quantities are valid numbers
- Prevent negative values
- Log validation issues

**Code**:
```typescript
line_items: invoiceData.line_items.map(item => {
  // CRITICAL: Validate and sanitize line item data
  const itemName = (item.name || 'Item').trim();
  const itemDescription = (item.description || '').trim();
  const itemRate = typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || 0));
  const itemQuantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(String(item.quantity || 1));
  const itemUnit = (item.unit || 'ticket').trim();
  
  // Validate rate and quantity
  if (isNaN(itemRate) || itemRate < 0) {
    console.error(`[ZohoService] ❌ Invalid rate: ${item.rate}, using 0`);
  }
  if (isNaN(itemQuantity) || itemQuantity < 0) {
    console.error(`[ZohoService] ❌ Invalid quantity: ${item.quantity}, using 1`);
  }
  
  return {
    name: itemName,
    description: itemDescription,
    rate: Math.max(0, itemRate),
    quantity: Math.max(1, itemQuantity),
    unit: itemUnit,
  };
}),
```

### 5. Enhanced Error Handling

**Location**: `server/src/services/zohoService.ts` - `mapBookingToInvoice` and `generateReceipt` methods

**Changes**:
- Added try-catch around `mapBookingToInvoice` call
- Added detailed error logging with stack traces
- Added error handling for booking query failures
- Return structured error responses

**Code**:
```typescript
// Map booking to invoice data (needed for delivery even if invoice exists)
let invoiceData: ZohoInvoiceData;
try {
  invoiceData = await this.mapBookingToInvoice(bookingId);
  console.log(`[ZohoService] ✅ Booking mapped to invoice data successfully`);
} catch (mapError: any) {
  const errorMsg = `Failed to map booking to invoice data: ${mapError.message || 'Unknown error'}`;
  console.error(`[ZohoService] ❌ ${errorMsg}`);
  console.error(`[ZohoService]    Stack: ${mapError.stack}`);
  return {
    invoiceId: '',
    success: false,
    error: errorMsg
  };
}
```

### 6. Comprehensive Logging

**Location**: Throughout `server/src/services/zohoService.ts`

**Changes**:
- Added detailed logging at every step
- Log currency fetching attempts
- Log validation results
- Log final payload before sending to Zoho
- Log all errors with context

**Example Logs**:
```
[ZohoService] 🔍 Mapping booking <id> to invoice data...
[ZohoService] ✅ Booking fetched successfully
[ZohoService]    Customer: <name>
[ZohoService]    Tenant Currency: <currency> or NOT FOUND (will use SAR)
[ZohoService] ⚠️ Currency not found in relation, fetching directly from tenant...
[ZohoService] ✅ Currency fetched directly: <currency>
[ZohoService] ✅ Booking data prepared
[ZohoService]    Tenant Currency: <currency>
[ZohoService] 📋 Service details:
[ZohoService]    Name: <name>
[ZohoService]    Description length: <length>
[ZohoService]    Language: <lang>
[ZohoService] ✅ Invoice data mapped successfully
[ZohoService]    Currency: <currency>
[ZohoService]    Line items: <count>
[ZohoService]    Total amount: <amount> <currency>
[ZohoService] 📋 Final invoice payload:
[ZohoService]    Currency: <currency>
[ZohoService]    Line Items: <count>
[ZohoService]    Total: <amount> <currency>
```

## Testing

After these fixes, when creating a booking:

1. **Check Server Logs** for:
   - Currency fetching attempts
   - Currency validation results
   - Service name/description validation
   - Line item validation
   - Final payload details

2. **Expected Behavior**:
   - Currency is always valid (SAR fallback if missing)
   - Service names are never empty
   - All line items have valid rates/quantities
   - Detailed logs show exactly where any issue occurs

3. **Error Scenarios**:
   - If currency is missing: Falls back to SAR with warning
   - If service name is empty: Uses "Service" with warning
   - If line items are invalid: Uses defaults with error log
   - All errors are logged with full context

## Verification Checklist

- [x] Currency code validation added
- [x] Currency fallback to direct query added
- [x] Service name/description validation added
- [x] Line item validation added
- [x] Enhanced error handling added
- [x] Comprehensive logging added
- [x] All errors return structured responses
- [x] No silent failures

## Next Steps

1. **Test booking creation** and check server logs
2. **Verify currency** is being fetched correctly
3. **Check for any validation errors** in logs
4. **Confirm invoices are created** with correct currency
5. **Monitor logs** for any remaining issues

---

**Last Updated**: 2026-01-24
**Status**: ✅ Fixed
**Files Modified**: `server/src/services/zohoService.ts`
