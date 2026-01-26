# Zoho OAuth Fix - Use Redirect Flow Instead

## 🔍 Issue

The self-client flow tokens are not working for any region. This suggests we need to use the **OAuth redirect flow** instead, which is more reliable and properly configured.

## ✅ Solution: Use OAuth Redirect Flow

### Step 1: Make Sure Server is Running

```bash
cd project/server
npm run dev
```

### Step 2: Start OAuth Flow

Open this URL in your browser:
```
http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
```

### Step 3: Complete OAuth Flow

1. You'll be redirected to Zoho login
2. Log in with your Zoho account
3. Authorize the application
4. You'll be redirected back to the callback URL
5. Tokens will be automatically stored in the database

### Step 4: Verify Tokens

After completing OAuth, check if tokens are stored:

```bash
cd project/server
node scripts/check-zoho-region.js
```

### Step 5: Test Invoice Delivery

```bash
cd project/server
npx tsx scripts/test-direct-delivery.js <booking_id>
```

## 🔧 Why OAuth Redirect Flow is Better

1. **Proper Region Detection**: Automatically uses the correct region based on your Zoho account
2. **Correct Scopes**: Ensures all required scopes are granted
3. **Better Token Management**: Tokens are properly linked to your organization
4. **No Manual Configuration**: No need to manually set API base URL

## 📋 Current Status

- ✅ Authorization code exchanged successfully
- ❌ Tokens not working for any region (suggests scope/permission issue)
- ✅ OAuth redirect flow will fix this

## ⚠️ Important Notes

1. **Don't use self_client.json code**: The authorization code in `self_client.json` might be for a different flow or expired
2. **Use OAuth redirect**: The redirect flow is the recommended method for production
3. **Check Zoho Invoice URL**: After OAuth, verify which region your organization uses

## 🎯 Expected Outcome

After completing OAuth redirect flow:
- ✅ Tokens will be stored in database
- ✅ Region will be automatically detected
- ✅ Invoice delivery will work
- ✅ Both email and WhatsApp delivery will function

## 💡 Troubleshooting

### If OAuth redirect doesn't work:

1. **Check redirect URI**: Make sure `http://localhost:3001/api/zoho/callback` is configured in Zoho Developer Console
2. **Check server is running**: The callback URL must be accessible
3. **Check browser console**: Look for any JavaScript errors
4. **Check server logs**: Look for OAuth callback errors

### If tokens still don't work after OAuth:

1. **Check Zoho Invoice access**: Make sure your Zoho account has access to Zoho Invoice
2. **Check organization**: Verify your organization is set up in Zoho Invoice
3. **Check scopes**: Verify the scopes include `ZohoInvoice.invoices.READ`

