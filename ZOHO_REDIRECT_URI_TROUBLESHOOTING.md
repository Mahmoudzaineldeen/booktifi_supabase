# Zoho Redirect URI Troubleshooting Guide

## Problem
You're getting "Invalid Redirect Uri" error even though you've added `http://localhost:3001/api/zoho/callback` to Zoho Developer Console.

## Diagnostic Steps

### Step 1: Check What Redirect URI is Actually Being Sent

Run this diagnostic script:
```bash
cd project/server
node scripts/check-zoho-redirect-uri.js YOUR_TENANT_ID
```

This will show:
- What redirect URI is stored in the database
- What redirect URI will be used in the OAuth flow
- Exact instructions on what to configure in Zoho

### Step 2: Check Server Logs

When you click "Connect to Zoho", check your server console. You should see:
```
[Zoho Routes] Redirect URI: http://localhost:3001/api/zoho/callback
[Zoho Routes] ⚠️  IMPORTANT: Make sure the redirect URI "..." is configured in Zoho Developer Console
```

**Copy the EXACT URI from the logs** - this is what Zoho expects.

### Step 3: Verify Zoho Developer Console Configuration

1. **Go to Zoho Developer Console**
   - https://api-console.zoho.com/
   - Sign in

2. **Find Your Application**
   - Look for the application with your Client ID
   - The Client ID should match what's in your Settings page

3. **Check Authorized Redirect URIs**
   - Click "Edit" or "Settings"
   - Find "Authorized Redirect URIs" section
   - **Verify the EXACT URI from Step 2 is listed**
   - Common mistakes:
     - ❌ `http://localhost:3001/api/zoho/callback/` (trailing slash)
     - ❌ `http://localhost:3001/api/zoho/callback ` (trailing space)
     - ❌ `https://localhost:3001/api/zoho/callback` (https instead of http)
     - ❌ `http://localhost:3001/zoho/callback` (missing /api)
     - ✅ `http://localhost:3001/api/zoho/callback` (correct)

4. **Save and Wait**
   - Click "Save" or "Update"
   - **Wait 10-30 seconds** for Zoho to propagate changes
   - Zoho's servers need time to update

### Step 4: Clear Browser Cache

Sometimes browser cache can cause issues:
- Clear browser cache
- Try in incognito/private mode
- Or try a different browser

### Step 5: Verify Client ID Match

Make sure the Client ID in:
- **Zoho Developer Console** (the application you're editing)
- **Settings page** (Client ID field)

**Match exactly**. If they don't match, you're editing the wrong application in Zoho.

## Common Issues and Solutions

### Issue 1: Multiple Applications in Zoho
**Symptom:** You have multiple Zoho applications, editing the wrong one
**Solution:** 
- Check the Client ID in Settings page
- Find the application in Zoho with that EXACT Client ID
- Edit that specific application

### Issue 2: Redirect URI Not Saved in Zoho
**Symptom:** You added the URI but it's not showing in the list
**Solution:**
- Make sure you clicked "Save" or "Update" after adding
- Refresh the page and verify it's still there
- Some Zoho interfaces require clicking "Add" then "Save"

### Issue 3: Changes Not Propagated
**Symptom:** You saved but still getting error
**Solution:**
- Wait 30-60 seconds after saving
- Zoho's servers need time to update globally
- Try again after waiting

### Issue 4: Wrong Region
**Symptom:** Using wrong Zoho region (com vs eu vs in)
**Solution:**
- Check your region setting in Settings page
- Make sure you're editing the application in the correct Zoho region
- Zoho.com (US) vs Zoho.eu (Europe) vs Zoho.in (India) are different systems

### Issue 5: Redirect URI Case Sensitivity
**Symptom:** URI looks correct but still fails
**Solution:**
- Domain part (localhost) is case-insensitive
- Path part (/api/zoho/callback) is case-sensitive
- Make sure path matches exactly: `/api/zoho/callback` (lowercase)

## Quick Fix Checklist

- [ ] Run diagnostic script to get exact redirect URI
- [ ] Copy the EXACT URI from diagnostic output
- [ ] Go to Zoho Developer Console
- [ ] Find application with matching Client ID
- [ ] Add the EXACT URI to "Authorized Redirect URIs"
- [ ] Verify no trailing slashes or spaces
- [ ] Click "Save" or "Update"
- [ ] Wait 30 seconds
- [ ] Clear browser cache
- [ ] Try "Connect to Zoho" again

## Still Not Working?

If you've tried everything above:

1. **Check if redirect URI is saved in database:**
   ```sql
   SELECT redirect_uri FROM tenant_zoho_configs WHERE tenant_id = 'YOUR_TENANT_ID';
   ```

2. **Update redirect URI in database if needed:**
   ```sql
   UPDATE tenant_zoho_configs 
   SET redirect_uri = 'http://localhost:3001/api/zoho/callback' 
   WHERE tenant_id = 'YOUR_TENANT_ID';
   ```

3. **Restart the server** to clear any caches

4. **Check server logs** when clicking "Connect to Zoho" - the exact redirect URI will be logged

5. **Try creating a new Zoho application** with the correct redirect URI from the start

