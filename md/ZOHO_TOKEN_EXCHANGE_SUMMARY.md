# Zoho Self Client Token Exchange - Summary

## ✅ What Was Created

1. **`exchange-code-for-tokens.js`** - Complete script for Self Client token exchange
2. **`ZOHO_SELF_CLIENT_GUIDE.md`** - Comprehensive documentation

## 📋 Script Features

### Step 1: Read self_client.json
- ✅ Securely reads credentials from backend file
- ✅ Validates required fields (client_id, client_secret, code)
- ✅ Never exposes secrets to frontend

### Step 2: Exchange Code for Tokens
- ✅ POST request to `https://accounts.zoho.com/oauth/v2/token`
- ✅ Handles both with and without redirect_uri
- ✅ Extracts access_token and refresh_token
- ✅ Comprehensive error handling

### Step 3: Store Tokens Securely
- ✅ Stores in `zoho_tokens` database table
- ✅ Refresh token saved for long-term use
- ✅ Access token expiration tracked

### Step 4: Refresh Token Usage
- ✅ Demonstrates how to use refresh tokens
- ✅ Shows automatic token refresh pattern

## 🔒 Security Features

1. **Backend-only**: All credential handling on server
2. **Database storage**: Tokens stored securely, not in files
3. **No frontend exposure**: Secrets never sent to client
4. **Production-safe**: Supports environment variable overrides

## ⚠️ Current Issue

The authorization code in `self_client.json` is **expired or already used**.

**Authorization codes are:**
- One-time use only
- Expire quickly (usually within minutes)
- Cannot be reused

## 🔧 Solutions

### Option 1: Get New Authorization Code

1. Go to https://api-console.zoho.com/
2. Find your client application
3. Generate a new authorization code
4. Update `self_client.json`:
   ```json
   {
     "client_id": "1000.11W8WXV5NHQZK87XTN54UNREEVFTEW",
     "client_secret": "51f35f11fe3a89107abfc7b3cce504ab286fd688ab",
     "code": "NEW_CODE_HERE",
     "grant_type": "authorization_code",
     "scope": ["ZohoInvoice.invoices.CREATE", "ZohoInvoice.contacts.CREATE", "ZohoInvoice.contacts.READ"]
   }
   ```
5. Run the script again:
   ```bash
   node scripts/exchange-code-for-tokens.js
   ```

### Option 2: Use OAuth Redirect Flow

If you can't get a new code, use the OAuth redirect flow:

1. Make sure redirect URI is configured in Zoho:
   ```
   http://localhost:3001/api/zoho/callback
   ```

2. Start OAuth flow:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

3. Complete authorization in browser

4. Tokens will be stored automatically

## 📝 Usage After Token Exchange

Once tokens are stored:

```javascript
// Get access token (auto-refreshes if expired)
const accessToken = await zohoService.getAccessToken(tenantId);

// Create invoice
const invoice = await zohoService.createInvoice(tenantId, invoiceData);
```

## 🚀 Next Steps

1. **Get new authorization code** from Zoho Developer Console
2. **Update self_client.json** with the new code
3. **Run the script**: `node scripts/exchange-code-for-tokens.js`
4. **Verify tokens stored**: Check `zoho_tokens` table
5. **Create invoice**: `node scripts/create-invoice-simple-api.js`

## 📚 Documentation

- **Full Guide**: `project/server/scripts/ZOHO_SELF_CLIENT_GUIDE.md`
- **Script**: `project/server/scripts/exchange-code-for-tokens.js`

