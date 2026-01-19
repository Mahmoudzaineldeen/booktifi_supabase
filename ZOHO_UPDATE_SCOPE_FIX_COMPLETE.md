# Zoho UPDATE Scope Fix - Complete Solution

## Problem Summary
The existing Zoho OAuth token was obtained **BEFORE** UPDATE scope was added to the code. Even though we've fixed the code to request UPDATE scope, the stored token doesn't have UPDATE permissions.

**Key Issue**: Token refresh doesn't change scopes - it only gets a new `access_token` with the same scopes as the original token.

## Solution Implemented

### 1. Store Granted Scopes ✅
- Added `granted_scopes` column to `zoho_tokens` table
- Store scopes when tokens are saved after OAuth
- Migration: `supabase/migrations/20250131000002_add_scopes_to_zoho_tokens.sql`

### 2. Scope Detection ✅
- Check stored scopes before attempting UPDATE operations
- Method: `checkStoredTokenHasUpdateScope()` in `zohoService.ts`
- Returns `{ hasUpdate: boolean; scopes?: string }`

### 3. Pre-emptive Error Detection ✅
- If stored token doesn't have UPDATE scope, return error immediately
- No need to make API call that will fail
- Provides specific error message with current scopes

### 4. Disconnect Functionality ✅
- Added "Disconnect" button to Settings page
- Calls `POST /api/zoho/disconnect` to delete tokens
- Allows user to clear old token and reconnect

### 5. Improved Error Messages ✅
- Detects authorization errors (401/403)
- Checks stored scopes to provide specific guidance
- Includes step-by-step instructions to fix

## How to Fix the Issue

### Step 1: Run Database Migration
Run this SQL in Supabase SQL Editor:
```sql
-- Add scopes column if it doesn't exist
ALTER TABLE zoho_tokens
ADD COLUMN IF NOT EXISTS granted_scopes TEXT;
```

### Step 2: Disconnect from Zoho
1. Go to **Settings → Zoho Invoice Integration**
2. Click **"Disconnect"** button (newly added)
3. This clears the old token without UPDATE scope

### Step 3: Reconnect to Zoho
1. Click **"Connect to Zoho"** again
2. You should see **5 scopes** in the consent screen:
   - ✅ Scope to create invoices
   - ✅ Scope to fetch invoice details
   - ✅ **Scope to update invoice details** ← This is the UPDATE scope!
   - ✅ Scope to create customers
   - ✅ Scope to fetch customer details
3. Authorize with all permissions

### Step 4: Verify
After reconnecting, check server logs:
```
[Zoho Routes] ✅ UPDATE scope confirmed - payment status sync will work
```

## What Changed

### Backend Changes
1. **`server/src/services/zohoService.ts`**:
   - Added `checkStoredTokenHasUpdateScope()` method
   - Check scopes before attempting UPDATE operations
   - Improved error messages with scope information
   - Store granted scopes when tokens are saved

2. **`server/src/routes/zoho.ts`**:
   - Store granted scopes when tokens are saved
   - Log scope verification in callback

3. **`supabase/migrations/20250131000002_add_scopes_to_zoho_tokens.sql`**:
   - Add `granted_scopes` column to store scopes

### Frontend Changes
1. **`src/pages/tenant/SettingsPage.tsx`**:
   - Added "Disconnect" button (shown when connected)
   - Added `handleZohoDisconnect()` function
   - Calls `/api/zoho/disconnect` endpoint

## Verification

### Check Stored Scopes
```sql
SELECT 
  tenant_id,
  granted_scopes,
  expires_at,
  created_at
FROM zoho_tokens
WHERE tenant_id = 'your-tenant-id';
```

**Expected**: `granted_scopes` should include `ZohoInvoice.invoices.UPDATE`

### Check Server Logs
When updating payment status, look for:
- ✅ `[ZohoService] ✅ Token has UPDATE scope - payment status sync will work`
- ❌ `[ZohoService] ⚠️  Stored token does not have UPDATE scope` (if old token)

## Important Notes

1. **Token Refresh Doesn't Change Scopes**: When a token is refreshed, it gets a new `access_token` but keeps the same scopes. You must disconnect and reconnect to get new scopes.

2. **Old Tokens**: Tokens obtained before UPDATE scope was added will never have UPDATE permissions, even after refresh.

3. **Database Migration**: The `granted_scopes` column is optional - old tokens without it will be detected and prompt reconnection.

4. **Booking Updates Still Work**: Even if Zoho sync fails, the booking payment status is updated in the database. Only the Zoho invoice sync fails.

## Status

✅ **All code implemented and pushed to GitHub**  
✅ **Disconnect functionality added**  
✅ **Scope detection implemented**  
✅ **Error messages improved**  
✅ **Database migration created**

## Next Steps

1. **Run the migration** to add `granted_scopes` column
2. **Disconnect from Zoho** in Settings
3. **Reconnect to Zoho** to get new token with UPDATE scope
4. **Test payment status update** - should sync to Zoho successfully

After these steps, payment status updates will sync to Zoho invoices correctly!
