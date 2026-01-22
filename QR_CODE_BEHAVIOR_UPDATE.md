# QR Code Behavior Update - Structured Data Instead of URLs

## Overview

QR codes have been updated to contain **structured booking data (JSON)** instead of URLs. This change ensures:
- ✅ External scanners display booking data directly (no redirect, no URL exposure)
- ✅ Internal scanners parse JSON to extract booking ID for validation
- ✅ Backward compatibility with legacy URL and UUID formats

## Changes Made

### 1. QR Code Generation (`server/src/services/pdfService.ts`)

**Before**: QR codes contained URLs like:
```
https://backend.com/api/bookings/{uuid}/details
```

**After**: QR codes contain structured JSON:
```json
{
  "booking_id": "uuid",
  "service": "Service Name",
  "service_ar": "اسم الخدمة",
  "date": "2026-01-22",
  "time": "20:00 - 21:00",
  "tenant": "Tenant Name",
  "customer": "Customer Name",
  "price": 100.00,
  "payment_status": "unpaid",
  "status": "confirmed",
  "type": "booking_ticket",
  "version": "1.0"
}
```

### 2. Backend QR Validation (`server/src/routes/bookings.ts`)

Updated `extractBookingIdFromQR()` to support:
1. **JSON format (new)**: Parses `booking_id` from JSON payload
2. **URL format (legacy)**: Extracts UUID from URLs
3. **UUID format (legacy)**: Direct UUID strings

### 3. Frontend QR Utilities (`src/lib/qrUtils.ts`)

Created shared utility functions:
- `extractBookingIdFromQR()`: Extracts booking ID from any format
- `parseQRContentForDisplay()`: Parses JSON for external display

### 4. Frontend Scanner Updates

Updated all scanner components to use shared utilities:
- `src/pages/cashier/CashierPage.tsx`
- `src/pages/reception/ReceptionPage.tsx`
- `src/pages/public/QRScannerPage.tsx`

## Behavior by Scanner Type

### External QR Scanners (Phone Camera, WhatsApp, Third-party Apps)

**Behavior**:
- ✅ Scan QR code
- ✅ Display JSON data directly (read-only)
- ✅ No redirect to any URL
- ✅ No backend URL exposure
- ✅ Works offline-friendly (pure QR payload)

**Displayed Data**:
- Booking ID
- Service name (English & Arabic)
- Date & time
- Tenant/provider name
- Customer name
- Price
- Payment status
- Booking status

### Internal System QR Scanner (Cashier/Receptionist)

**Behavior**:
- ✅ Scan QR code
- ✅ Parse JSON to extract `booking_id`
- ✅ Fetch live booking data from backend
- ✅ Validate booking
- ✅ Determine QR status (valid, already scanned, expired, cancelled)
- ✅ Update booking scan state (if valid)
- ✅ Mark ticket as used

**QR Status Display**:
- ✅ Valid: Shows booking details, allows payment update
- ⚠️ Already Scanned: Shows original scan timestamp
- ❌ Expired/Cancelled: Shows appropriate error message

## Backward Compatibility

### Legacy QR Codes Still Work

The system maintains full backward compatibility:

1. **URL-based QR codes** (old format):
   ```
   https://backend.com/api/bookings/{uuid}/details
   ```
   - Internal scanner extracts UUID from URL
   - External scanner may attempt to open URL (legacy behavior)

2. **UUID-only QR codes** (very old format):
   ```
   123e4567-e89b-12d3-a456-426614174000
   ```
   - Works with both internal and external scanners
   - External scanners display UUID directly

### Migration Path

- **New bookings**: Automatically use JSON format
- **Old bookings**: Continue to work with existing QR codes
- **No user action required**: System handles all formats automatically

## Technical Details

### QR Code Payload Structure

```typescript
interface QRPayload {
  booking_id: string;        // Required: UUID for internal validation
  service?: string;           // Optional: Service name (English)
  service_ar?: string;         // Optional: Service name (Arabic)
  date?: string;              // Optional: Booking date (YYYY-MM-DD)
  time?: string;              // Optional: Time range (HH:MM - HH:MM)
  tenant?: string;            // Optional: Tenant name (English)
  tenant_ar?: string;         // Optional: Tenant name (Arabic)
  customer?: string;          // Optional: Customer name
  price?: number;             // Optional: Total price
  payment_status?: string;     // Optional: Payment status
  status?: string;            // Optional: Booking status
  type: 'booking_ticket';     // Required: Payload type identifier
  version: '1.0';             // Required: Payload version
}
```

### Extraction Logic Priority

1. **Try JSON parse** → Extract `booking_id` if valid
2. **Try UUID regex** → Match if raw UUID
3. **Try URL pattern** → Extract UUID from `/bookings/{uuid}/` path
4. **Try UUID anywhere** → Find UUID in any string format
5. **Return null** → Invalid QR code

## Validation Boundary Enforcement

| Scanner Type | Can Validate | Can Change State | Can Redirect |
|-------------|--------------|------------------|--------------|
| External QR Scanner | ❌ No | ❌ No | ❌ No |
| Internal QR Scanner | ✅ Yes | ✅ Yes | ❌ No |

## Testing Checklist

### ✅ External Scanner Tests

- [ ] Scan QR code with phone camera
- [ ] Verify JSON data displays directly
- [ ] Verify no redirect occurs
- [ ] Verify all booking fields are visible
- [ ] Test with WhatsApp QR scanner
- [ ] Test with third-party QR app

### ✅ Internal Scanner Tests

- [ ] Scan QR code as cashier
- [ ] Verify booking ID extracted correctly
- [ ] Verify booking details fetched
- [ ] Verify QR status displayed
- [ ] Verify payment status can be updated
- [ ] Test with already-scanned QR
- [ ] Test with cancelled booking

### ✅ Backward Compatibility Tests

- [ ] Test with old URL-based QR code
- [ ] Test with UUID-only QR code
- [ ] Verify both formats still work
- [ ] Verify no errors for legacy formats

## Files Modified

### Backend
- `server/src/services/pdfService.ts` - QR code generation
- `server/src/routes/bookings.ts` - QR validation endpoint

### Frontend
- `src/lib/qrUtils.ts` - **NEW** - Shared QR utilities
- `src/pages/cashier/CashierPage.tsx` - Cashier scanner
- `src/pages/reception/ReceptionPage.tsx` - Receptionist scanner
- `src/pages/public/QRScannerPage.tsx` - Public scanner

## Next Steps

1. **Test with real bookings**: Create new bookings and verify QR codes contain JSON
2. **Verify external scanners**: Test with various QR scanner apps
3. **Monitor production**: Check Railway logs for QR generation
4. **User feedback**: Collect feedback on QR code display quality

## Notes

- QR codes are now **data-based, not URL-based**
- No backend URLs are exposed in QR codes
- External scanners work **offline-friendly**
- Internal scanners maintain full validation capabilities
- All legacy QR codes continue to work
