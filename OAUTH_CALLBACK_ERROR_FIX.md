# OAuth Callback Error Fix

## Error: "Authorization code is missing"

This error occurs when the OAuth callback is received but Zoho didn't provide an authorization code.

## Common Causes

1. **Direct URL Access**: You accessed the callback URL directly without going through the OAuth flow
2. **Redirect URI Mismatch**: The redirect URI doesn't exactly match what's configured in Zoho
3. **User Denied Access**: You clicked "Deny" or "Cancel" in the Zoho authorization page
4. **Zoho Error**: Zoho encountered an error but didn't include error parameters

## Solution Steps

### Step 1: Verify Redirect URI in Zoho

1. Go to https://api-console.zoho.com/
2. Find your application
3. Check the "Authorized Redirect URIs" section
4. Make sure it includes exactly:
   ```
   http://localhost:3001/api/zoho/callback
   ```
5. No trailing slashes, no extra spaces

### Step 2: Start OAuth Flow Correctly

**Don't access the callback URL directly!** Instead:

1. Start the OAuth flow from the auth endpoint:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

2. This will redirect you to Zoho's login page

3. Sign in and click **"Allow"** or **"Authorize"** (not "Deny")

4. Zoho will redirect you back to the callback URL with a code

### Step 3: Check Server Logs

The improved error handler now logs all query parameters. Check your server console for:
```
[Zoho Routes] Callback received: { hasCode: false, hasState: true, ... }
```

This will help diagnose the issue.

## Improved Error Handling

The callback route now:
- ✅ Detects Zoho error responses (`error` parameter)
- ✅ Provides helpful HTML error pages (not just JSON)
- ✅ Logs all query parameters for debugging
- ✅ Shows clear instructions on what to do

## Testing

1. Make sure the server is running
2. Open the auth URL in your browser:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```
3. Complete the OAuth flow
4. You should see a success page, not an error

## Next Steps After Success

Once OAuth is successful, you can create the invoice:
```bash
cd project/server
node scripts/create-invoice-simple-api.js
```

