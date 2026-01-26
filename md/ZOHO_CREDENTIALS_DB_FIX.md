# Zoho Credentials Database Fix

## Problem
Zoho credentials were being loaded from environment variables or `self_client.json` file at startup, causing errors if not found. The system should read credentials from the database per tenant instead.

## Solution Implemented

### 1. Updated `zohoCredentials.loadCredentials()`
**File**: `server/src/config/zohoCredentials.ts`

- Made `loadCredentials()` non-blocking (returns `null` instead of throwing if credentials not found)
- Added `required` parameter (default: `false`) to control whether to throw error
- Credentials are now loaded per-tenant from database when needed

### 2. Updated Startup Logging
**File**: `server/src/index.ts`

- Changed startup to not fail if global credentials not found
- Updated message to indicate credentials will be loaded from database per tenant
- Removed error throwing at startup

### 3. Updated ZohoService Constructor
**File**: `server/src/services/zohoService.ts`

- Constructor no longer throws error if credentials not found
- Credentials are loaded per-tenant from database when needed
- Added `getApiBaseUrlForTenant()` method to get region-specific API URLs

### 4. Enhanced Tenant-Specific Credential Loading
**File**: `server/src/config/zohoCredentials.ts`

- `getCredentialsForTenant()` already loads from `tenant_zoho_configs` table
- Falls back to global credentials only if tenant config not found
- Improved error messages when tenant credentials not configured

## How It Works Now

### Credential Loading Priority (Per Tenant):
1. **Tenant Database Config** (highest priority)
   - Loaded from `tenant_zoho_configs` table
   - Tenant-specific `client_id`, `client_secret`, `region`
   - Cached per tenant for performance

2. **Global Environment Variables** (fallback)
   - `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET`
   - Used if tenant config not found

3. **Global File** (fallback)
   - `self_client.json` file
   - Used if environment variables not set

### Startup Behavior:
- ✅ Server starts successfully even without global credentials
- ✅ Logs indicate credentials will be loaded from database per tenant
- ✅ No errors thrown at startup

### Runtime Behavior:
- ✅ When Zoho operation is needed, credentials are loaded from database for that tenant
- ✅ If tenant has no config, falls back to global credentials (if available)
- ✅ Clear error messages if no credentials available at all

## Database Schema

Zoho credentials are stored in `tenant_zoho_configs` table:
```sql
CREATE TABLE tenant_zoho_configs (
  id uuid PRIMARY KEY,
  tenant_id uuid UNIQUE NOT NULL,
  client_id varchar(255) NOT NULL,
  client_secret varchar(255) NOT NULL,
  redirect_uri varchar(500),
  scopes text[],
  region varchar(50) DEFAULT 'com',
  is_active boolean DEFAULT true
);
```

## Configuration

Tenants can configure Zoho credentials via:
- **Settings Page**: `/{tenantSlug}/admin/settings` → Integrations → Zoho
- **API Endpoint**: `PUT /api/tenants/zoho-config`

## Testing

1. **Start server** - should start without errors even without global credentials
2. **Configure tenant credentials** - via Settings page
3. **Test Zoho operations** - credentials loaded from database automatically

## Status

✅ **Fixed**: Zoho credentials now read from database per tenant
✅ **Startup**: No longer fails if global credentials not found
✅ **Runtime**: Credentials loaded from database when needed
