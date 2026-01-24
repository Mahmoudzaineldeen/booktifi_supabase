# Zoho Token Auto-Refresh Fix - Final Solution

## Problem

The Zoho token has expired, but the code was rejecting it before attempting to refresh it using the refresh_token.

## Root Cause

The precondition check was rejecting expired tokens before calling `getAccessToken()`, which would have automatically refreshed them.

## Solution Applied

### 1. Removed Expiration Rejection from Precondition Check

**File**: `server/src/services/zohoService.ts`

**Changed**: The precondition check now only verifies that a token record exists. It no longer rejects expired tokens. Instead, it logs a warning and continues, allowing `getAccessToken()` to handle the refresh.

**Before**:
```typescript
if (expiresAt <= now) {
  // Reject and return error
  return { success: false, error: "Token expired" };
}
```

**After**:
```typescript
if (minutesUntilExpiry <= 0) {
  console.warn(`Token is expired - getAccessToken() will attempt to refresh using refresh_token`);
}
// Continue - getAccessToken() will handle refresh
```

### 2. Enhanced getAccessToken() Logging

**File**: `server/src/services/zohoService.ts`

Added detailed logging to show when tokens are being refreshed:

```typescript
async getAccessToken(tenantId: string): Promise<string> {
  // ... get token from DB ...
  
  if (timeUntilExpiry < buffer) {
    if (timeUntilExpiry <= 0) {
      console.log(`Token is expired (${minutesUntilExpiry} minutes ago), refreshing...`);
    } else {
      console.log(`Token expires soon (${minutesUntilExpiry} minutes), refreshing...`);
    }
    try {
      const newAccessToken = await this.refreshAccessToken(tenantId, token.refresh_token);
      console.log(`✅ Token refreshed successfully`);
      return newAccessToken;
    } catch (refreshError: any) {
      console.error(`❌ Failed to refresh token: ${refreshError.message}`);
      throw new Error(`Failed to refresh Zoho token. Please reconnect Zoho...`);
    }
  }
  
  return token.access_token;
}
```

## How It Works Now

1. **Precondition Check**: Only verifies token record exists (doesn't check expiration)
2. **getAccessToken() Call**: When invoice creation needs a token, it calls `getAccessToken()`
3. **Auto-Refresh**: `getAccessToken()` checks if token is expired or expiring soon
4. **Refresh Attempt**: If expired/expiring, it automatically calls `refreshAccessToken()` using the refresh_token
5. **Success**: New access token is returned and used for invoice creation
6. **Failure**: If refresh fails (e.g., refresh_token is invalid), a clear error is thrown

## Expected Behavior

### Scenario 1: Token Expired
- ✅ Precondition check passes (token record exists)
- ✅ `getAccessToken()` detects expiration
- ✅ Automatically refreshes using refresh_token
- ✅ Invoice creation proceeds with new token

### Scenario 2: Token Expiring Soon (< 5 minutes)
- ✅ Precondition check passes
- ✅ `getAccessToken()` detects expiration soon
- ✅ Automatically refreshes proactively
- ✅ Invoice creation proceeds with fresh token

### Scenario 3: Token Valid (> 5 minutes)
- ✅ Precondition check passes
- ✅ `getAccessToken()` returns existing token
- ✅ Invoice creation proceeds

### Scenario 4: Refresh Token Invalid
- ✅ Precondition check passes
- ✅ `getAccessToken()` attempts refresh
- ❌ Refresh fails
- ❌ Clear error message: "Failed to refresh Zoho token. Please reconnect Zoho in Settings → Zoho Integration"

## Deployment Required

**Status**: Code changes are complete, but Railway needs to be restarted/deployed with the new code.

**Steps**:
1. ✅ Code changes applied locally
2. ⏳ Deploy to Railway (restart server)
3. ⏳ Test invoice creation

## Testing After Deployment

1. **Test with expired token**:
   ```bash
   node tests/test-manual-invoice-trigger.js
   ```
   Expected: Token should be auto-refreshed and invoice created

2. **Create new booking**:
   - Create a booking through receptionist interface
   - Check Railway logs for `[ZohoService] getAccessToken()` messages
   - Verify invoice is created

3. **Check logs**:
   Look for these log messages:
   - `[ZohoService] Token is expired - getAccessToken() will attempt to refresh`
   - `[ZohoService] Token expired or expiring soon, refreshing...`
   - `[ZohoService] ✅ Token refreshed successfully`

## Files Modified

1. `server/src/services/zohoService.ts`
   - Removed expiration rejection from precondition check
   - Enhanced `getAccessToken()` logging
   - Added error handling for refresh failures

## Current Token Status

- **Token Expired**: Yes (expired at 2026-01-24T23:45:55.715Z)
- **Refresh Token**: Available
- **Expected Behavior**: Token should be auto-refreshed on next invoice creation attempt

---

**Status**: ✅ Code Fixed (Needs Deployment)
**Last Updated**: 2026-01-24
**Next Step**: Deploy to Railway and test
