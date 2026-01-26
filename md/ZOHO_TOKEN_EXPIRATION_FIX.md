# Zoho Token Expiration Fix

## Problem Identified

**Root Cause**: The Zoho token expiration check was too strict, rejecting tokens that were still valid but close to expiration.

**Details**:
- Token expires at: `2026-01-24T23:45:55.715Z`
- Current time (test): `2026-01-24T23:45:41.568Z`
- Token is still valid (expires in ~14 seconds)
- But the code was using a 5-minute buffer, rejecting tokens that expire within 5 minutes

**Impact**:
- Invoices are not being created for bookings
- Error: "Zoho connection expired" even though token is still valid
- Token auto-refresh in `getAccessToken()` never gets a chance to run because we reject before calling it

## Fix Applied

### 1. ZohoService.generateReceipt() - Precondition Check

**File**: `server/src/services/zohoService.ts`

**Before**:
```typescript
const bufferMinutes = 5; // 5 minute buffer
const expiresAtWithBuffer = new Date(expiresAt.getTime() - (bufferMinutes * 60 * 1000));
if (expiresAtWithBuffer <= now) {
  // Reject token
}
```

**After**:
```typescript
// Only reject if token is actually expired (not just close to expiration)
// getAccessToken() will handle auto-refresh for tokens close to expiration
if (expiresAt <= now) {
  // Only reject if actually expired
} else {
  // Token is valid - getAccessToken() will handle refresh if needed
  if (minutesUntilExpiry <= 5) {
    console.warn(`Token expires soon - will be auto-refreshed by getAccessToken()`);
  }
  // Continue - don't block invoice creation for valid tokens
}
```

### 2. Booking Creation Route - Token Check

**File**: `server/src/routes/bookings.ts`

**Before**:
```typescript
const bufferMinutes = 5;
const expiresAtWithBuffer = new Date(expiresAt.getTime() - (bufferMinutes * 60 * 1000));
if (expiresAtWithBuffer <= now) {
  return; // Exit early
}
```

**After**:
```typescript
// Only reject if token is actually expired (not just close to expiration)
// getAccessToken() will handle auto-refresh for tokens close to expiration
if (expiresAt <= now) {
  // Only reject if actually expired
} else {
  // Token is valid - getAccessToken() will handle refresh if needed
  // Continue - don't block invoice creation for valid tokens
}
```

## How Token Refresh Works

The `getAccessToken()` method in `zohoService.ts` already handles auto-refresh:

```typescript
async getAccessToken(tenantId: string): Promise<string> {
  // Get existing token
  const token = await getTokenFromDB(tenantId);
  
  // Check if token is expired (with 5 minute buffer)
  const expiresAt = new Date(token.expires_at);
  const now = new Date();
  const buffer = 5 * 60 * 1000; // 5 minutes
  
  if (expiresAt.getTime() - now.getTime() < buffer) {
    // Auto-refresh token
    return await this.refreshAccessToken(tenantId, token.refresh_token);
  }
  
  return token.access_token;
}
```

**Key Point**: `getAccessToken()` will automatically refresh tokens that expire within 5 minutes. We don't need to reject them in the precondition check - we should let `getAccessToken()` handle it.

## Expected Behavior After Fix

1. **Token expires in 10 minutes**: ✅ Invoice creation proceeds, token is used as-is
2. **Token expires in 3 minutes**: ✅ Invoice creation proceeds, `getAccessToken()` auto-refreshes it
3. **Token expires in 1 minute**: ✅ Invoice creation proceeds, `getAccessToken()` auto-refreshes it
4. **Token is actually expired**: ❌ Invoice creation fails with clear error message

## Deployment Steps

1. **Code Changes**: ✅ Already applied
2. **Deploy to Railway**: User needs to deploy/restart the server
3. **Test**: Create a new booking and verify invoice is created
4. **Monitor Logs**: Check for `[Booking Creation]` and `[ZohoService]` messages

## Verification

After deployment, test with:

```bash
node tests/test-manual-invoice-trigger.js
```

Expected result:
- ✅ Invoice creation should proceed even if token expires soon
- ✅ Token should be auto-refreshed by `getAccessToken()`
- ✅ Invoice should be created successfully

## Additional Improvements Made

1. **Enhanced Logging**: Added comprehensive logging at every step
2. **Currency Validation**: Added fallback fetching and validation
3. **Service Name Validation**: Added fallbacks for empty service names
4. **Line Item Validation**: Added validation for rates and quantities
5. **Error Handling**: Improved error messages and stack traces

## Files Modified

1. `server/src/services/zohoService.ts`
   - Fixed token expiration check in `generateReceipt()`
   - Added currency fallback fetching
   - Added service name/description validation
   - Added line item validation
   - Enhanced error handling

2. `server/src/routes/bookings.ts`
   - Fixed token expiration check in booking creation
   - Added comprehensive logging
   - Enhanced error handling

3. `server/src/routes/zoho.ts`
   - Fixed `require('jsonwebtoken')` → `import jwt from 'jsonwebtoken'`

---

**Status**: ✅ Fixed (needs deployment)
**Last Updated**: 2026-01-24
**Next Step**: Deploy to Railway and test
