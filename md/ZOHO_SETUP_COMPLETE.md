# Zoho OAuth Setup - Complete Guide

## ✅ Configuration Updated

Your Zoho credentials have been saved to the database:
- **Client ID**: `1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME`
- **Redirect URI**: `http://localhost:3001/api/zoho/callback`
- **Region**: `com` (United States)

## ⚠️ CRITICAL: Update Zoho Developer Console

**You MUST update the redirect URI in Zoho Developer Console before proceeding!**

### Current Issue
- Zoho has: `http://localhost:5173/api/zoho/callback` (frontend port - WRONG)
- Should be: `http://localhost:3001/api/zoho/callback` (backend port - CORRECT)

### Steps to Fix

1. **Go to Zoho Developer Console**
   - Visit: https://api-console.zoho.com/
   - Sign in with your Zoho account

2. **Find Your Application**
   - Look for application: **booktifi**
   - Client ID should be: `1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME`

3. **Edit Redirect URI**
   - Click "Edit" or "Settings"
   - Find "Authorized Redirect URIs" section
   - **REMOVE**: `http://localhost:5173/api/zoho/callback`
   - **ADD**: `http://localhost:3001/api/zoho/callback`
   - **Important**: No trailing slash, no extra spaces
   - Click "Save" or "Update"

4. **Wait for Propagation**
   - Wait 30-60 seconds after saving
   - Zoho needs time to update globally

## 🔗 OAuth Authorization URL

After updating Zoho Developer Console, open this URL in your browser:

```
https://accounts.zoho.com/oauth/v2/auth?scope=ZohoInvoice.invoices.CREATE%2CZohoInvoice.invoices.READ%2CZohoInvoice.contacts.CREATE%2CZohoInvoice.contacts.READ&client_id=1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME&response_type=code&access_type=offline&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fzoho%2Fcallback&state=eyJ0ZW5hbnRfaWQiOiI2MzEwN2IwNi05MzhlLTRjZTYtYjBmMy01MjBhODdkYjM5N2IifQ==
```

Or use the Settings page: Click "Connect to Zoho" button.

## 📝 Complete OAuth Flow

### Step 1: Authorize Application
1. Open the OAuth URL above (or click "Connect to Zoho" in Settings)
2. Sign in to Zoho if prompted
3. Click "Allow" or "Authorize" to grant permissions
4. You'll be redirected to: `http://localhost:3001/api/zoho/callback?code=...`

### Step 2: Exchange Code for Tokens

**Option A: Automatic (Recommended)**
- The callback page will automatically exchange the code for tokens
- You'll see a success message
- Tokens are stored in the database

**Option B: Manual (If automatic fails)**
1. Copy the `code` parameter from the redirect URL
2. Run:
   ```bash
   cd project/server
   node scripts/exchange-code-tenant.js <code>
   ```

### Step 3: Verify Connection

Check the connection status in Settings → Zoho Invoice Integration:
- Should show: "✓ Connected"
- Token expiration date should be displayed

## ⚠️ Important Notes

### Client Secret Warning
The Client Secret you provided appears identical to the Client ID. Please verify:
- Go to Zoho Developer Console
- Check the actual Client Secret
- Update it in Settings if different

### Region Code
You provided a region code hash: `ca28f8b5d5de079d9bbc0638601920b51a06ffc940`
- This doesn't match standard Zoho regions (com, eu, in, au, jp)
- Currently set to `com` (United States)
- If your Zoho account is in a different region, update it in Settings

### Testing

After completing OAuth:
1. Go to Settings → Zoho Invoice Integration
2. Click "Test Connection"
3. Should show: "Zoho connection test successful!"

## 🐛 Troubleshooting

### "Invalid Redirect Uri" Error
- Make sure you updated Zoho Developer Console (see above)
- Verify the redirect URI is exactly: `http://localhost:3001/api/zoho/callback`
- Wait 30-60 seconds after updating
- Clear browser cache

### "Authorization code is missing"
- Make sure you complete the OAuth flow
- Don't close the popup window
- Check browser console for errors

### "Token exchange failed"
- Verify Client Secret is correct
- Check that the authorization code hasn't expired (codes are one-time use)
- Make sure redirect URI matches exactly

### "This user is not associated with any organization"
- Log in to https://invoice.zoho.com/ (or your region)
- Create an organization if needed
- Re-authorize the application

## ✅ Success Checklist

- [ ] Updated redirect URI in Zoho Developer Console to port 3001
- [ ] Waited 30 seconds for changes to propagate
- [ ] Opened OAuth authorization URL
- [ ] Authorized the application
- [ ] Tokens exchanged successfully
- [ ] Connection status shows "Connected"
- [ ] Test connection passes

## 📞 Next Steps

Once OAuth is complete:
1. Invoices will be automatically created for bookings
2. Invoices will be sent via WhatsApp and email
3. Customers can view invoices in their billing page
4. All Zoho Invoice features are now active

