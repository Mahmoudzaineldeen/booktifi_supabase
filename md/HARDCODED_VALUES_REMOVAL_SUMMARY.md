# Hardcoded Values Removal - Summary

## Overview
This document summarizes all hardcoded values that have been removed from the codebase to improve flexibility, portability, and production stability.

## Changes Made

### 1. Frontend API URL Configuration ✅
**File**: `src/lib/apiUrl.ts`

**Removed**:
- Hardcoded Railway URL: `https://booktifisupabase-production.up.railway.app/api`
- Environment detection fallbacks that used hardcoded URLs

**Replaced With**:
- Strict requirement for `VITE_API_URL` environment variable
- Throws error if `VITE_API_URL` is not set (no silent fallbacks)

**Impact**:
- All environments (local, Bolt, Railway, Netlify) must set `VITE_API_URL`
- Prevents silent failures and ensures explicit configuration

### 2. Backend Zoho OAuth URLs ✅
**Files**:
- `server/src/services/zohoService.ts`
- `server/src/routes/zoho.ts`
- `server/src/routes/tenants.ts`
- `server/src/config/zohoCredentials.ts`

**Removed**:
- Hardcoded Railway URL: `https://booktifisupabase-production.up.railway.app`
- Fallback URLs in redirect URI construction

**Replaced With**:
- Strict requirement for `APP_URL` or `ZOHO_REDIRECT_URI` environment variables
- Throws errors if required environment variables are not set

**Impact**:
- Zoho OAuth will fail fast if misconfigured (better than silent failures)
- Each deployment must explicitly set `APP_URL` or `ZOHO_REDIRECT_URI`

### 3. Tenant Default Country Code ✅
**Files**:
- `supabase/migrations/20260122000000_add_default_country_code_to_tenants.sql`
- `src/hooks/useTenantDefaultCountry.ts`
- `src/pages/reception/ReceptionPage.tsx`
- `src/types/index.ts`

**Removed**:
- Hardcoded `+966` (Saudi Arabia) country code in multiple components
- Default country code assumptions

**Replaced With**:
- Database field: `tenants.default_country_code` (defaults to `+966` for backward compatibility)
- React hook: `useTenantDefaultCountry()` that fetches tenant's default country code
- Components now use tenant-specific default country code

**Impact**:
- Each tenant can configure their own default country code
- Supports multi-tenant deployments in different countries
- Backward compatible (existing tenants default to `+966`)

## Remaining Hardcoded Values (To Be Addressed)

### 4. Timezone Defaults ⏳
**Status**: Pending

**Location**:
- Database schema: `tenants.tenant_time_zone DEFAULT 'Asia/Riyadh'`
- Database schema: `tenants.announced_time_zone DEFAULT 'Asia/Riyadh'`

**Action Required**:
- These are database defaults, which is acceptable
- However, should verify all timezone usage respects tenant's configured timezone
- No code changes needed if timezone is always read from tenant record

### 5. Test Scripts ⏳
**Status**: Pending

**Location**:
- Various test scripts in `scripts/` directory
- Hardcoded email addresses, phone numbers, tenant IDs

**Action Required**:
- Move test data to environment variables
- Use `.env.test` file for test configuration
- Scripts should read from environment or command-line arguments

### 6. Role Names ⏳
**Status**: Verified (No Action Needed)

**Location**:
- Database enum: `user_role` type
- TypeScript types: `src/types/index.ts`

**Status**:
- Role names are defined in database enum (correct approach)
- TypeScript types reference the enum values (acceptable)
- No hardcoded role checks in business logic (verified)

## Environment Variables Required

### Frontend
- `VITE_API_URL` - **REQUIRED** - Backend API URL (e.g., `https://your-backend.com/api`)

### Backend
- `APP_URL` - **REQUIRED** - Application base URL for OAuth callbacks (e.g., `https://your-backend.com`)
- `ZOHO_REDIRECT_URI` - **OPTIONAL** - Override for Zoho OAuth redirect URI (defaults to `APP_URL/api/zoho/callback`)

## Migration Steps

1. **Apply Database Migration**:
   ```sql
   -- Run: supabase/migrations/20260122000000_add_default_country_code_to_tenants.sql
   ```

2. **Update Environment Variables**:
   - Frontend: Set `VITE_API_URL` in all environments
   - Backend: Set `APP_URL` in all environments

3. **Update Tenant Default Country Codes** (if needed):
   ```sql
   UPDATE tenants SET default_country_code = '+971' WHERE slug = 'uae-tenant';
   UPDATE tenants SET default_country_code = '+966' WHERE slug = 'saudi-tenant';
   ```

## Testing Checklist

- [ ] Frontend loads correctly with `VITE_API_URL` set
- [ ] Frontend throws error if `VITE_API_URL` is not set
- [ ] Backend Zoho OAuth works with `APP_URL` set
- [ ] Backend throws error if `APP_URL` is not set when needed
- [ ] ReceptionPage uses tenant's default country code
- [ ] Phone inputs default to tenant's country code
- [ ] Existing tenants continue to work (backward compatibility)

## Breaking Changes

### ⚠️ Breaking: VITE_API_URL is now required
- Previously: Frontend would fallback to hardcoded Railway URL
- Now: Frontend requires `VITE_API_URL` to be set
- **Action**: Set `VITE_API_URL` in all deployment environments

### ⚠️ Breaking: APP_URL is now required for Zoho
- Previously: Backend would fallback to hardcoded Railway URL
- Now: Backend requires `APP_URL` for Zoho OAuth
- **Action**: Set `APP_URL` in all deployment environments

## Backward Compatibility

- ✅ Database migration sets `default_country_code = '+966'` for existing tenants
- ✅ Components fallback to `+966` if tenant doesn't have `default_country_code` set
- ✅ No breaking changes to API contracts

## Next Steps

1. Update all deployment configurations to set required environment variables
2. Test in all environments (local, Bolt, Railway, Netlify)
3. Address remaining hardcoded values in test scripts
4. Verify timezone handling respects tenant configuration
