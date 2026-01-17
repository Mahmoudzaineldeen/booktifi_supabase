# Zoho Redirect URI Test & Verification Guide

## ✅ URI Format Validation

**Test URI:**
```
https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
```

**Validation Results:**
- ✅ Protocol: `https:` (correct)
- ✅ Hostname: Valid WebContainer hostname
- ✅ Path: `/api/zoho/callback` (correct, no trailing slash)
- ✅ Length: 118 characters (acceptable)
- ✅ Format: Matches expected pattern

## 📋 Verification Checklist

### Step 1: Verify URI in Zoho Developer Console

1. **Go to Zoho Developer Console:**
   - Visit: https://api-console.zoho.com/
   - Sign in with your Zoho account

2. **Find Your Application:**
   - Locate your application (matching your Client ID)
   - Click to open details

3. **Check Authorized Redirect URIs:**
   - Click "Edit" or "Settings"
   - Find "Authorized Redirect URIs" section
   - **Verify this EXACT URI is listed:**
     ```
     https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
     ```

4. **Important Checks:**
   - ✅ No trailing slash (`/api/zoho/callback` not `/api/zoho/callback/`)
   - ✅ No extra spaces
   - ✅ Exact match (case-sensitive for domain)
   - ✅ Protocol is `https://` (not `http://`)

### Step 2: Test OAuth Flow in Bolt

1. **Ensure Backend Server is Running:**
   ```bash
   # In Bolt terminal
   npm run dev
   ```
   - Look for: `🚀 API Server running on http://localhost:3001`

2. **Navigate to Settings:**
   - In Bolt, go to: Settings → Zoho Invoice Integration

3. **Click "Connect to Zoho"**

4. **Check Server Logs:**
   You should see:
   ```
   [Zoho Routes] ========================================
   [Zoho Routes] INITIATING OAUTH FLOW
   [Zoho Routes] Detected Origin: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io
   [Zoho Routes] Origin Source: Frontend
   [Zoho Routes] Using Redirect URI: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
   [Zoho Routes] ========================================
   ```

5. **Check Browser Console:**
   You should see:
   ```
   [Zoho Connect] Passing origin to backend: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io
   ```

6. **Complete OAuth Flow:**
   - Authorize on Zoho
   - Check callback logs:
     ```
     [Zoho Routes] State decoded: {
       tenantId: '<your-tenant-id>',
       hasRedirectUri: true,
       redirectUri: 'https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback'
     }
     [Zoho Routes] ✅ Using redirect URI from state: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
     ```

### Step 3: Verify Token Exchange

During token exchange, check logs for:
```
[Zoho Routes] TOKEN EXCHANGE STARTING
[Zoho Routes] ⚠️  CRITICAL: Redirect URI must match EXACTLY what was sent to Zoho during authorization
[Zoho Routes] Redirect URI being used: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
[Zoho Routes] Full redirect_uri: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
```

## 🔍 Troubleshooting

### Issue: "invalid_redirect_uri" Error

**Symptoms:**
```
[Zoho Routes] Token response data: {
  "error": "invalid_redirect_uri"
}
```

**Solutions:**

1. **Verify URI in Zoho Developer Console:**
   - Copy the EXACT URI from server logs
   - Paste it into Zoho Developer Console
   - No modifications, exact match

2. **Check for Common Mistakes:**
   - ❌ Trailing slash: `/api/zoho/callback/` (wrong)
   - ✅ No trailing slash: `/api/zoho/callback` (correct)
   - ❌ Extra spaces: ` /api/zoho/callback ` (wrong)
   - ✅ No spaces: `/api/zoho/callback` (correct)
   - ❌ Wrong protocol: `http://` instead of `https://` (wrong)
   - ✅ Correct protocol: `https://` (correct)

3. **Wait for Propagation:**
   - After adding URI in Zoho, wait 30-60 seconds
   - Zoho needs time to update globally

4. **Verify State Contains Redirect URI:**
   - Check logs for: `hasRedirectUri: true`
   - If `false`, the state wasn't set correctly during authorization

### Issue: Redirect URI Mismatch

**Symptoms:**
- Authorization uses one URI
- Token exchange uses different URI

**Solution:**
- Both must use the SAME redirect URI
- Check logs to compare:
  - Authorization: `[Zoho Routes] Using Redirect URI: <uri>`
  - Token Exchange: `[Zoho Routes] Redirect URI being used: <uri>`
- They must match exactly

## ✅ Success Indicators

When everything works correctly, you should see:

1. **Authorization Logs:**
   ```
   [Zoho Routes] Using Redirect URI: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
   ```

2. **Callback Logs:**
   ```
   [Zoho Routes] State decoded: {
     hasRedirectUri: true,
     redirectUri: 'https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback'
   }
   [Zoho Routes] ✅ Using redirect URI from state: https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
   ```

3. **Token Exchange Success:**
   ```
   [Zoho Routes] ✅ Token response received
   [Zoho Routes] Token response status: 200
   [Zoho Routes] Token response data: {
     "access_token": "...",
     "refresh_token": "...",
     "expires_in": 3600
   }
   ```

4. **Success Page:**
   - Browser shows: "✅ Zoho Integration Successful!"
   - Popup closes automatically
   - Settings page shows: "Zoho account connected successfully!"

## 📝 Complete URI List for Zoho Developer Console

Add ALL of these URIs to Zoho Developer Console:

```
http://localhost:5173/api/zoho/callback
http://localhost:3001/api/zoho/callback
https://zp1v56uxy8rdx5ypatb0ockcb9tr6a-oci3--5173--31fc58ec.local-credentialless.webcontainer-api.io/api/zoho/callback
```

**Note:** If your Bolt URL changes, you'll need to add the new URL to Zoho Developer Console.
