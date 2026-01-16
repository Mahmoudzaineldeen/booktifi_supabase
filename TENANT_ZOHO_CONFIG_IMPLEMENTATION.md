# Tenant-Specific Zoho Configuration Implementation

## Overview
This implementation enables each tenant (service provider) in the SaaS platform to configure their own Zoho Invoice integration credentials, allowing multi-tenant architecture where each business connects their own Zoho account.

## What Was Implemented

### 1. Database Schema
**File:** `project/supabase/migrations/20250131000000_create_tenant_zoho_configs_table.sql`

- Created `tenant_zoho_configs` table to store tenant-specific Zoho OAuth credentials
- Fields: `client_id`, `client_secret`, `redirect_uri`, `scopes`, `region`, `is_active`
- Unique constraint on `tenant_id` (one config per tenant)
- Foreign key to `tenants` table with CASCADE delete

### 2. API Endpoints
**File:** `project/server/src/routes/tenants.ts`

Added three new endpoints:
- `GET /api/tenants/zoho-config` - Get tenant's Zoho configuration (without secret)
- `PUT /api/tenants/zoho-config` - Save/update tenant's Zoho credentials
- `GET /api/tenants/zoho-status` - Get connection status (config + tokens)
- `POST /api/tenants/zoho-config/test` - Test Zoho connection

### 3. Credential Manager Updates
**File:** `project/server/src/config/zohoCredentials.ts`

- Added `getCredentialsForTenant(tenantId)` method
- Priority order: Tenant DB config → Global env vars → `self_client.json`
- Added tenant-specific methods: `getClientIdForTenant`, `getClientSecretForTenant`, etc.
- Added caching for tenant credentials
- Added `clearTenantCache()` for credential updates

### 4. OAuth Flow Updates
**File:** `project/server/src/routes/zoho.ts`

- Updated `/api/zoho/auth` to use tenant-specific credentials
- Updated `/api/zoho/callback` to use tenant-specific credentials and region
- Supports different Zoho regions (com, eu, in, au, jp)

### 5. Zoho Service Updates
**File:** `project/server/src/services/zohoService.ts`

- Updated `refreshAccessToken()` to use tenant-specific credentials
- Token refresh now uses correct region-specific endpoints

### 6. Settings Page UI
**File:** `project/src/pages/tenant/SettingsPage.tsx`

Added complete Zoho Integration section with:
- Connection status indicator (config saved, account connected, token expiry)
- Setup instructions with links
- Form fields: Client ID, Client Secret, Region
- Three action buttons:
  - **Connect to Zoho** - Opens OAuth flow in new window
  - **Test Connection** - Tests if credentials and tokens work
  - **Save Zoho Settings** - Saves credentials to database

## User Flow for New Service Provider

### Step 1: Sign Up
- Service provider creates account via signup page
- Tenant is created in database

### Step 2: Configure Zoho (in Settings)
1. Navigate to Settings page
2. Scroll to "Zoho Invoice Integration" section
3. Follow setup instructions:
   - Go to [Zoho Developer Console](https://api-console.zoho.com/)
   - Create "Server-based Application"
   - Set Redirect URI: `https://yourapp.com/api/zoho/callback`
   - Copy Client ID and Client Secret
4. Enter credentials in Settings:
   - Client ID
   - Client Secret
   - Region (com, eu, in, au, jp)
5. Click **"Save Zoho Settings"**
6. Click **"Connect to Zoho"** to authorize
   - Opens OAuth flow in new window
   - User logs in to Zoho
   - Grants permissions
   - Redirects back and stores tokens
7. Click **"Test Connection"** to verify everything works

### Step 3: Automatic Invoice Generation
- When bookings are created, invoices are automatically generated
- Uses tenant-specific Zoho account
- Invoices sent via email and WhatsApp

## Security Considerations

1. **Client Secret Protection**
   - Never returned in API responses
   - Stored in database (should be encrypted at application level in production)
   - Masked in UI (password field)

2. **Tenant Isolation**
   - Each tenant can only access their own config
   - API endpoints validate `tenant_id` from JWT token
   - Database queries filtered by `tenant_id`

3. **Credential Rotation**
   - Tenants can update credentials anytime
   - Old tokens invalidated when new OAuth flow completes
   - Cache cleared on credential updates

## Migration Instructions

1. **Apply Database Migration**
   ```bash
   cd project/server
   node scripts/apply-migration.js supabase/migrations/20250131000000_create_tenant_zoho_configs_table.sql
   ```

   Or manually run the SQL in your PostgreSQL database.

2. **Restart Server**
   ```bash
   npm run dev
   ```

3. **Test the Flow**
   - Log in as a tenant admin
   - Go to Settings → Zoho Invoice Integration
   - Follow the setup instructions

## Fallback Behavior

If a tenant hasn't configured their own Zoho credentials:
- System falls back to global credentials (env vars or `self_client.json`)
- This allows gradual migration
- Existing tenants continue working with global config
- New tenants can configure their own

## API Usage Examples

### Get Zoho Config
```bash
GET /api/tenants/zoho-config
Authorization: Bearer <token>
```

### Save Zoho Config
```bash
PUT /api/tenants/zoho-config
Authorization: Bearer <token>
Content-Type: application/json

{
  "client_id": "1000.XXXXXXXXXXXXX",
  "client_secret": "your-secret",
  "region": "com"
}
```

### Get Connection Status
```bash
GET /api/tenants/zoho-status
Authorization: Bearer <token>
```

### Test Connection
```bash
POST /api/tenants/zoho-config/test
Authorization: Bearer <token>
```

## Next Steps

1. **Encryption**: Add application-level encryption for `client_secret` in database
2. **Audit Logging**: Log all credential changes for security
3. **Onboarding Wizard**: Add guided setup wizard for first-time users
4. **Error Handling**: Add more specific error messages for common issues
5. **Documentation**: Add help tooltips and links to Zoho documentation

## Files Modified

- `project/supabase/migrations/20250131000000_create_tenant_zoho_configs_table.sql` (NEW)
- `project/server/src/routes/tenants.ts` (UPDATED)
- `project/server/src/config/zohoCredentials.ts` (UPDATED)
- `project/server/src/routes/zoho.ts` (UPDATED)
- `project/server/src/services/zohoService.ts` (UPDATED)
- `project/src/pages/tenant/SettingsPage.tsx` (UPDATED)

## Testing Checklist

- [ ] Apply database migration
- [ ] Test saving Zoho credentials
- [ ] Test OAuth flow with tenant-specific credentials
- [ ] Test invoice creation with tenant-specific account
- [ ] Test fallback to global credentials
- [ ] Test connection status display
- [ ] Test connection test functionality
- [ ] Verify tenant isolation (tenant A can't see tenant B's config)

