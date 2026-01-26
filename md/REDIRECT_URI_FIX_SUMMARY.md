# Redirect URI Fix - Quick Summary

## ✅ What We Found

- **Current Redirect URI**: `http://localhost:3001/api/zoho/callback`
- **Client ID**: `1000.11W8WXV5NHQZK87XTN54UNREEVFTEW`

## 🔧 Quick Fix

1. Go to: https://api-console.zoho.com/
2. Find your application (Client ID: `1000.11W8WXV5NH...`)
3. Click "Edit" or "Settings"
4. Add to "Authorized Redirect URIs":
   ```
   http://localhost:3001/api/zoho/callback
   ```
5. Save and wait 10-30 seconds
6. Try OAuth again:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

## 📋 Full Details

See `FIX_REDIRECT_URI.md` for complete instructions and troubleshooting.

