# Zoho Refresh Token Fix

## Problem
Zoho OAuth was returning `access_token` but NOT `refresh_token`, causing the following issues:
- Access token expires after 1 hour
- Without refresh token, automatic token renewal fails
- Users would need to reconnect manually every hour
- Invoices would stop being created after token expiration

## Root Cause
The OAuth authorization URL was missing the `prompt=consent` parameter. Without this:
- Zoho may skip the consent screen on subsequent authorizations
- When consent screen is skipped, Zoho only returns `access_token`
- The `refresh_token` is only returned when user explicitly grants consent

## Solution Applied

### 1. Added `prompt=consent` Parameter
**File**: `project/server/src/routes/zoho.ts`

```typescript
const authUrl = `${accountsUrl}?` +
  `scope=${encodeURIComponent(scope)}&` +
  `client_id=${clientId}&` +
  `response_type=code&` +
  `access_type=offline&` +        // ✅ Already present
  `prompt=consent&` +              // ✅ ADDED - Forces consent screen
  `redirect_uri=${encodeURIComponent(redirectUri)}&` +
  `state=${state}`;
```

### 2. Enhanced Logging
Added detailed logging to confirm parameters:
```
[Zoho Routes] INITIATING OAUTH FLOW
[Zoho Routes] Access Type: offline (for refresh_token)
[Zoho Routes] Prompt: consent (force consent screen)
[Zoho Routes] ⚠️  These parameters ensure refresh_token is returned
```

## How It Works

### OAuth Parameters Explained

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `scope` | `ZohoInvoice.invoices.CREATE,...` | API permissions requested |
| `client_id` | Your Zoho Client ID | Identifies your application |
| `response_type` | `code` | OAuth 2.0 authorization code flow |
| `access_type` | `offline` | Request offline access (refresh token) |
| `prompt` | `consent` | **Force consent screen every time** |
| `redirect_uri` | `http://localhost:3001/api/zoho/callback` | Where Zoho redirects after auth |
| `state` | Base64 encoded tenant_id | Security token + tenant identification |

### Why Both Parameters Are Needed

1. **`access_type=offline`**: Tells Zoho you want offline access
   - Indicates the app needs to access Zoho when user is not present
   - Required but not sufficient alone

2. **`prompt=consent`**: Forces the consent screen
   - Ensures user explicitly grants permissions
   - **This is the key parameter that guarantees refresh_token is returned**
   - Without it, Zoho may skip consent and only return access_token

## Expected Token Response

### ✅ CORRECT (With Both Parameters)
```json
{
  "access_token": "1000.xxx...",
  "refresh_token": "1000.yyy...",  ← THIS IS WHAT WE NEED
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "ZohoInvoice.invoices.CREATE ..."
}
```

### ❌ INCORRECT (Without prompt=consent)
```json
{
  "access_token": "1000.xxx...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "ZohoInvoice.invoices.CREATE ..."
  // ❌ NO refresh_token!
}
```

## Verification Steps

### 1. Check Server Logs During OAuth
When you click "Connect to Zoho", you should see:
```
[Zoho Routes] ========================================
[Zoho Routes] INITIATING OAUTH FLOW
[Zoho Routes] Access Type: offline (for refresh_token)
[Zoho Routes] Prompt: consent (force consent screen)
[Zoho Routes] ⚠️  These parameters ensure refresh_token is returned
[Zoho Routes] ========================================
```

### 2. Check Token Exchange Response
After authorizing, you should see:
```
[Zoho Routes] Token response data: {
  "access_token": "1000.eaae...",
  "refresh_token": "1000.xxxx...",  ← MUST BE PRESENT
  "scope": "...",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### 3. Verify in Database
```sql
SELECT 
  tenant_id,
  access_token IS NOT NULL as has_access_token,
  refresh_token IS NOT NULL as has_refresh_token,
  expires_at,
  created_at
FROM zoho_tokens
WHERE tenant_id = 'your-tenant-id';
```

Expected result:
```
has_access_token: true   ✅
has_refresh_token: true  ✅ (This must be true!)
```

## Testing Instructions

### 1. Restart the Server
```bash
cd "E:\New folder\sauidi tower\project\server"
npm run dev
```

### 2. Clear Existing Connection (Optional)
If you want to test from scratch:
```sql
DELETE FROM zoho_tokens WHERE tenant_id = 'your-tenant-id';
```

### 3. Connect to Zoho
1. Go to Settings → Zoho Invoice Integration
2. Click "Connect to Zoho"
3. You'll see Zoho's consent screen (even if you authorized before)
4. Click "Accept" or "Allow"
5. Window should close with success message

### 4. Verify Tokens
Check server logs for:
```
[Zoho Routes] ✅ Token response received
[Zoho Routes] Token response status: 200
[Zoho Routes] Token response data: {
  "access_token": "...",
  "refresh_token": "...",  ← MUST BE HERE
  ...
}
```

### 5. Test Invoice Creation
Create a booking and verify invoice is created automatically.

## What Happens Now

### Automatic Token Refresh
With the refresh token in place:

1. **Access token expires after 1 hour**
2. **System automatically detects expiration** (5-minute buffer)
3. **Uses refresh_token to get new access_token**
4. **Updates database with new token**
5. **Continues working seamlessly**

### No Manual Intervention Needed
- Invoices continue to be created automatically
- Token refresh happens in the background
- Connection stays active indefinitely (unless user revokes access)

## Troubleshooting

### Still Not Getting Refresh Token?

1. **Check Zoho Developer Console**
   - Ensure "Server-based Application" type is selected
   - Not "Client-based Application" or "Self Client"

2. **Verify Redirect URI**
   - Must match EXACTLY in Zoho Console and your settings
   - No trailing slashes
   - Correct protocol (http vs https)
   - Correct port

3. **Check Scopes**
   - Ensure scopes include offline access permissions
   - Default: `ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.contacts.CREATE,ZohoInvoice.contacts.READ`

4. **Region Mismatch**
   - Ensure you're using the correct Zoho region
   - US: accounts.zoho.com
   - EU: accounts.zoho.eu
   - India: accounts.zoho.in
   - Australia: accounts.zoho.com.au

### Error: "Failed to obtain tokens from Zoho"

If you see this error, check the detailed error response in logs:
```
[Zoho Routes] Zoho API error response: {
  status: 400,
  data: { error: "...", error_description: "..." }
}
```

Common errors:
- `invalid_code`: Authorization code already used or expired
- `invalid_client`: Client ID or Secret incorrect
- `redirect_uri_mismatch`: Redirect URI doesn't match

## Success Criteria

✅ OAuth flow completes successfully  
✅ Both `access_token` AND `refresh_token` received  
✅ Tokens stored in `zoho_tokens` table  
✅ Connection status shows "Connected"  
✅ Invoices are created automatically on booking  
✅ Tokens auto-refresh after 1 hour  
✅ No manual reconnection needed  

## References

- Zoho OAuth Documentation: https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html
- Zoho Invoice API: https://www.zoho.com/invoice/api/v3/
- OAuth 2.0 RFC: https://tools.ietf.org/html/rfc6749

---

**Status**: ✅ **FIX APPLIED AND READY FOR TESTING**

**Next Step**: Restart server and try "Connect to Zoho" again. You should now receive both tokens!

