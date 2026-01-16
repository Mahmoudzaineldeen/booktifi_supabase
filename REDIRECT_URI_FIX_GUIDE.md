# Fix "Invalid Redirect URI" Error

## Problem
When clicking "Connect to Zoho", you get:
```
Invalid Redirect Uri
Redirect URI passed does not match with the one configured
```

## Solution

### Step 1: Check the Redirect URI Being Used

The application will log the redirect URI in the server console. Check your server logs to see what URI is being sent to Zoho.

**Expected format:**
- Development: `http://localhost:3001/api/zoho/callback`
- Production: `https://yourdomain.com/api/zoho/callback`

### Step 2: Update Zoho Developer Console

1. **Go to Zoho Developer Console**
   - Visit: https://api-console.zoho.com/
   - Sign in with your Zoho account

2. **Find Your Application**
   - Look for your application (the one with your Client ID)
   - Click on it to open details

3. **Edit Authorized Redirect URIs**
   - Click "Edit" or "Settings"
   - Find "Authorized Redirect URIs" section
   - **Add the EXACT URI** that appears in your server logs
   - **Important:**
     - No trailing slashes
     - No extra spaces
     - Must match exactly (case-sensitive for domain)
     - Include the full path: `/api/zoho/callback`

4. **Save Changes**
   - Click "Save" or "Update"
   - Wait 10-30 seconds for changes to propagate

### Step 3: Configure Redirect URI in Settings

1. **Go to Settings → Zoho Invoice Integration**
2. **Enter the Redirect URI field**
   - Use the same URI you configured in Zoho Developer Console
   - Default: `http://localhost:3001/api/zoho/callback` (for development)
   - Or: `https://yourdomain.com/api/zoho/callback` (for production)
3. **Save the settings**
4. **Try "Connect to Zoho" again**

## Common Issues

### Issue 1: URI Mismatch
**Symptom:** Redirect URI error persists
**Solution:** 
- Check server logs for the exact URI being sent
- Copy that exact URI
- Paste it into Zoho Developer Console (no modifications)

### Issue 2: Trailing Slash
**Symptom:** URI has trailing slash
**Solution:**
- Remove trailing slash from both:
  - Zoho Developer Console
  - Settings page Redirect URI field

### Issue 3: HTTP vs HTTPS
**Symptom:** Using HTTP in production
**Solution:**
- For production, use HTTPS: `https://yourdomain.com/api/zoho/callback`
- For development, HTTP is fine: `http://localhost:3001/api/zoho/callback`

### Issue 4: Wrong Port
**Symptom:** Port mismatch
**Solution:**
- Check what port your server is running on
- Use that port in the redirect URI
- Default: `3001` for backend API

## Verification

After updating:
1. Check server logs - you should see:
   ```
   [Zoho Routes] Redirect URI: http://localhost:3001/api/zoho/callback
   [Zoho Routes] ⚠️  IMPORTANT: Make sure the redirect URI "..." is configured in Zoho Developer Console
   ```

2. Try "Connect to Zoho" again
3. You should be redirected to Zoho login (no error)

## Quick Fix Checklist

- [ ] Check server logs for exact redirect URI
- [ ] Copy the exact URI from logs
- [ ] Paste into Zoho Developer Console (Authorized Redirect URIs)
- [ ] Enter the same URI in Settings → Redirect URI field
- [ ] Save settings
- [ ] Wait 10-30 seconds
- [ ] Try "Connect to Zoho" again

