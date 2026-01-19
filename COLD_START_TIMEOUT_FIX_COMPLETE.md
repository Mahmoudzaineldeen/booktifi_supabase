# Cold Start Timeout Fix - Complete Implementation

## Problem
Railway backend cold starts can take 30-60 seconds, but frontend timeouts were too short (10 seconds), causing authentication requests to fail with timeout errors.

## Solution Implemented

### 1. Centralized Timeout Utility ✅
**File**: `src/lib/requestTimeout.ts`

Created a centralized utility that:
- Detects authentication endpoints automatically
- Applies 60-second timeout for auth endpoints (handles Railway cold starts)
- Applies appropriate timeouts for other endpoint types
- Provides reusable `createTimeoutSignal()` function

**Key Functions**:
- `getRequestTimeout(endpoint, isRelativeUrl)` - Returns appropriate timeout
- `createTimeoutSignal(endpoint, isRelativeUrl)` - Creates AbortSignal with timeout
- `isAuthEndpoint(endpoint)` - Checks if endpoint is auth-related

### 2. Updated Core Database Client ✅
**File**: `src/lib/db.ts`

- Now uses centralized timeout utility
- All requests through `db.request()` automatically get correct timeouts
- Auth endpoints: 60 seconds
- Tenant queries: 60 seconds
- Other endpoints: 10-30 seconds (based on URL type)

### 3. Updated All Direct Fetch Calls ✅

Updated files with direct fetch calls to use timeout signals:

1. **`src/pages/auth/ForgotPasswordPage.tsx`**
   - `/auth/forgot-password/lookup` - 60s timeout
   - `/auth/forgot-password` - 60s timeout
   - `/auth/verify-otp` - 60s timeout
   - `/auth/reset-password` - 60s timeout
   - `/auth/login-with-otp` - 60s timeout

2. **`src/pages/customer/CustomerForgotPasswordPage.tsx`**
   - All auth endpoints updated with 60s timeout

3. **`src/pages/public/CheckoutPage.tsx`**
   - `/auth/guest/verify-phone` - 60s timeout
   - `/auth/guest/verify-otp` - 60s timeout

4. **`src/pages/public/PhoneEntryPage.tsx`**
   - `/auth/check-phone` - 60s timeout
   - `/auth/guest/verify-phone` - 60s timeout
   - `/auth/guest/verify-otp` - 60s timeout

5. **`src/pages/admin/SolutionOwnerDashboard.tsx`**
   - `/auth/create-solution-owner` - 60s timeout

6. **`src/pages/tenant/SettingsPage.tsx`**
   - Health check timeout increased from 3s to 15s

7. **`src/pages/tenant/BookingsPage.tsx`**
   - Invoice download uses timeout signal

8. **`src/lib/serverHealth.ts`**
   - Health check timeout increased from 3s to 15s

## Timeout Configuration

### Authentication Endpoints (60 seconds)
- `/auth/signin`
- `/auth/signup`
- `/auth/forgot-password`
- `/auth/forgot-password/lookup`
- `/auth/verify-otp`
- `/auth/reset-password`
- `/auth/login-with-otp`
- `/auth/guest/verify-phone`
- `/auth/guest/verify-otp`
- `/auth/check-phone`
- `/auth/create-solution-owner`
- `/auth/refresh`
- `/auth/validate`

### Tenant Queries (60 seconds)
- `/tenants/*`
- `/query` with `table=tenants`

### Health Checks (15 seconds)
- `/health`

### Other Endpoints
- Relative URLs (local dev): 30 seconds
- Absolute URLs (production): 10 seconds

## Benefits

1. **Handles Railway Cold Starts**: 60-second timeout allows Railway to wake up
2. **Centralized Configuration**: All timeouts managed in one place
3. **Automatic Detection**: Auth endpoints automatically get longer timeouts
4. **Consistent Behavior**: All fetch calls use the same timeout logic
5. **Future-Proof**: Easy to adjust timeouts globally if needed

## Files Changed

### New Files
- `src/lib/requestTimeout.ts` - Centralized timeout utility

### Updated Files
- `src/lib/db.ts` - Uses centralized timeout
- `src/lib/serverHealth.ts` - Increased health check timeout
- `src/pages/auth/ForgotPasswordPage.tsx` - All auth endpoints
- `src/pages/customer/CustomerForgotPasswordPage.tsx` - All auth endpoints
- `src/pages/public/CheckoutPage.tsx` - Guest auth endpoints
- `src/pages/public/PhoneEntryPage.tsx` - Phone verification endpoints
- `src/pages/admin/SolutionOwnerDashboard.tsx` - Solution owner creation
- `src/pages/tenant/SettingsPage.tsx` - Health check
- `src/pages/tenant/BookingsPage.tsx` - Invoice download

## Testing

After deployment, test:
1. Sign in with Railway backend (should wait up to 60s for cold start)
2. Forgot password flow (all steps should handle cold starts)
3. Guest booking flow (phone verification should work)
4. Health checks (should wait up to 15s)

## Status

✅ **Complete** - All authentication and related endpoints now handle Railway cold starts properly.

The fix is comprehensive and permanent - all future auth requests will automatically use the 60-second timeout.
