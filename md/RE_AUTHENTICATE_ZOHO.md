# Re-authenticate Zoho - Quick Guide

## ❌ Current Issue

**Error**: `Token refresh failed. Please re-authenticate Zoho.`

**Cause**: The refresh token is invalid or expired. This happens when:
- The refresh token has been revoked
- The OAuth app settings changed in Zoho
- The token expired and refresh failed

## ✅ Solution: Re-authenticate Zoho

### Step 1: Check Token Status

First, check your current token status:

```bash
cd project/server
node scripts/check-zoho-token-status.js YOUR_TENANT_ID
```

Replace `YOUR_TENANT_ID` with your actual tenant ID (e.g., `63107b06-938e-4ce6-b0f3-520a87db397b`)

### Step 2: Re-authenticate Zoho

**Option A: Using Browser (Recommended)**

1. Open your browser
2. Visit this URL (replace `YOUR_TENANT_ID` with your tenant ID):
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=YOUR_TENANT_ID
   ```
   
   Example:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

3. You'll be redirected to Zoho login page
4. Log in with your Zoho account
5. Click "Allow" or "Authorize" to grant access
6. You'll be redirected back and see "✅ Zoho Integration Successful!"
7. New tokens will be stored automatically

**Option B: Using API Status Check**

Check if re-authentication is needed:

```bash
curl http://localhost:3001/api/zoho/status?tenant_id=YOUR_TENANT_ID
```

If it shows `"connected": false`, you need to re-authenticate.

### Step 3: Verify Authentication

After re-authenticating, verify it worked:

```bash
cd project/server
node scripts/check-zoho-token-status.js YOUR_TENANT_ID
```

You should see:
- ✅ Status: VALID
- Access Token: present
- Refresh Token: present
- Expires At: future date

### Step 4: Test Invoice Creation

Create a test booking or try to create an invoice:

```bash
# Test invoice creation via API
curl -X POST http://localhost:3001/api/zoho/test-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "YOUR_TENANT_ID",
    "booking_id": "YOUR_BOOKING_ID"
  }'
```

## 🔧 Troubleshooting

### If OAuth URL doesn't work:

1. **Check server is running**:
   ```bash
   cd project/server
   npm run dev
   ```

2. **Check redirect URI in Zoho**:
   - Go to Zoho Developer Console
   - Find your OAuth app
   - Ensure redirect URI is: `http://localhost:3001/api/zoho/callback`
   - Must match exactly (no trailing slash)

3. **Check credentials**:
   - Verify `self_client.json` exists in `project/server/`
   - Or set environment variables: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`

### If you get "Invalid Redirect URI":

1. Go to Zoho Developer Console
2. Edit your OAuth app
3. Add redirect URI: `http://localhost:3001/api/zoho/callback`
4. Save changes
5. Try OAuth flow again

### If tokens still don't work:

1. **Disconnect and reconnect**:
   ```bash
   curl -X POST http://localhost:3001/api/zoho/disconnect \
     -H "Content-Type: application/json" \
     -d '{"tenant_id": "YOUR_TENANT_ID"}'
   ```

2. Then re-authenticate using Step 2 above

## 📝 Quick Reference

**OAuth URL Format**:
```
http://localhost:3001/api/zoho/auth?tenant_id={TENANT_ID}
```

**Status Check**:
```
http://localhost:3001/api/zoho/status?tenant_id={TENANT_ID}
```

**Disconnect**:
```
POST http://localhost:3001/api/zoho/disconnect
Body: {"tenant_id": "{TENANT_ID}"}
```

## ✅ After Re-authentication

Once re-authenticated:
- ✅ New access token stored
- ✅ New refresh token stored
- ✅ Tokens will auto-refresh when expired
- ✅ Invoice creation will work
- ✅ WhatsApp delivery will work

The system will automatically use the new tokens for all future invoice operations!

