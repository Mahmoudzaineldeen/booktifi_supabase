# Zoho Redirect URI Troubleshooting Guide

## Problem
"Invalid Redirect URI: Redirect URI passed does not match with the one configured"

## Root Cause
The redirect URI being sent to Zoho doesn't exactly match what's configured in Zoho Developer Console.

## Solution Steps

### Step 1: Check What Redirect URI is Actually Being Sent

1. **Open Browser Console** (F12 → Console tab)
2. **Click "Connect to Zoho"** in your settings page
3. **Look for logs** that show:
   ```
   [Zoho Connect] Current Origin: https://bookati.netlify.app
   [Zoho Connect] ⚠️  Expected redirect URI: https://bookati.netlify.app/api/zoho/callback
   ```

4. **Check Railway Backend Logs**:
   - Go to Railway dashboard
   - View your backend service logs
   - Look for:
   ```
   [Zoho Routes] Detected Origin: https://bookati.netlify.app
   [Zoho Routes] Using Redirect URI: https://bookati.netlify.app/api/zoho/callback
   [Zoho Routes] ⚠️  CRITICAL: Redirect URI being sent to Zoho: https://bookati.netlify.app/api/zoho/callback
   ```

### Step 2: Verify Zoho Console Configuration

1. Go to [Zoho Developer Console](https://api-console.zoho.com/)
2. Select your application
3. Go to "Client" or "OAuth" settings
4. Find "Authorized Redirect URIs" or "Redirect URLs"
5. **Check the EXACT URI** - it must match exactly:
   - ✅ Correct: `https://bookati.netlify.app/api/zoho/callback`
   - ❌ Wrong: `https://bookati.netlify.app/api/zoho/callback/` (trailing slash)
   - ❌ Wrong: `https://bookati.netlify.app//api/zoho/callback` (double slash)
   - ❌ Wrong: `http://bookati.netlify.app/api/zoho/callback` (http instead of https)
   - ❌ Wrong: `bookati.netlify.app/api/zoho/callback` (missing protocol)

### Step 3: Common Issues and Fixes

#### Issue 1: Preview URL vs Production URL
**Problem:** Netlify preview URLs change with each deploy.

**Solution:** 
- Use your production domain: `https://bookati.netlify.app/api/zoho/callback`
- If you need to test with preview URLs, add both:
  - `https://bookati.netlify.app/api/zoho/callback` (production)
  - `https://*-*.netlify.app/api/zoho/callback` (preview - if Zoho supports wildcards)

#### Issue 2: Origin Detection Failing
**Problem:** Backend might be using a fallback origin instead of Netlify.

**Check:**
- Railway logs should show: `Origin Source: Frontend` or `Origin Source: Origin Header`
- If it shows `Origin Source: Environment Variable (APP_URL)` or `Host Header`, the origin detection failed

**Fix:**
- Ensure `APP_URL` in Railway is set to: `https://bookati.netlify.app`
- Or ensure the frontend is correctly passing the origin

#### Issue 3: Trailing Slash or Extra Characters
**Problem:** Zoho is very strict about exact matching.

**Fix:**
- Remove any trailing slashes
- Remove any spaces
- Ensure exact case matching (though URLs are case-insensitive)

### Step 4: Add Multiple Redirect URIs (If Needed)

If you need to support multiple environments, add all of them in Zoho Console:

1. Production: `https://bookati.netlify.app/api/zoho/callback`
2. Preview (if needed): `https://696e065adf1d5e0bb50daf80--delightful-florentine-7b58a9.netlify.app/api/zoho/callback`
3. Local (if testing): `http://localhost:5173/api/zoho/callback`

**Note:** Zoho allows multiple redirect URIs, so you can add all environments.

### Step 5: Verify After Fix

1. **Clear browser cache** (Ctrl+Shift+R)
2. **Go to settings page**: `https://bookati.netlify.app/fci/admin/settings`
3. **Open Console** (F12)
4. **Click "Connect to Zoho"**
5. **Check console logs** for the redirect URI being used
6. **Verify it matches** what's in Zoho Console exactly

## Debugging Checklist

- [ ] Check browser console for `[Zoho Connect] Current Origin`
- [ ] Check Railway logs for `[Zoho Routes] Using Redirect URI`
- [ ] Verify Zoho Console has the EXACT same URI (no trailing slash, correct protocol)
- [ ] Ensure `APP_URL` in Railway is set correctly (if origin detection fails)
- [ ] Try adding multiple redirect URIs in Zoho Console
- [ ] Clear browser cache and try again

## Quick Fix

If you're still having issues, try this:

1. **In Zoho Console**, add this EXACT URI (copy-paste, don't type):
   ```
   https://bookati.netlify.app/api/zoho/callback
   ```

2. **Save** in Zoho Console

3. **Wait 1-2 minutes** for Zoho to update

4. **Clear browser cache** (Ctrl+Shift+R)

5. **Try connecting again**

## Still Not Working?

If it still doesn't work:

1. **Check Railway logs** to see what redirect URI is actually being sent
2. **Copy the EXACT redirect URI** from the logs
3. **Add that EXACT URI** to Zoho Console (even if it's different from what you expect)
4. **Save and try again**

The redirect URI must match EXACTLY what's in the logs, not what you think it should be.
