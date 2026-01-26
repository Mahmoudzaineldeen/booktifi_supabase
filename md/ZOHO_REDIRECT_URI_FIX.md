# Fix "Invalid Redirect Uri" Error - Step by Step

## ✅ What We Know

The application is sending this EXACT redirect URI to Zoho:
```
http://localhost:3001/api/zoho/callback
```

**Character count:** 39 characters  
**No trailing slash:** ✅  
**No extra spaces:** ✅  
**Correct port (3001):** ✅

## 🔍 The Problem

Zoho is rejecting this URI, which means it's NOT configured correctly in Zoho Developer Console.

## 📋 Step-by-Step Fix

### Step 1: Verify You're Editing the Correct Application

1. Go to: **https://api-console.zoho.com/**
2. Sign in with your Zoho account
3. Look for application: **booktifi**
4. **VERIFY the Client ID matches:** `1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME`
   - If the Client ID doesn't match, you're editing the wrong application!
   - Find the application with the EXACT Client ID above

### Step 2: Check Current Redirect URIs

1. Click on the application (booktifi)
2. Click **"Edit"** or **"Settings"**
3. Scroll to **"Authorized Redirect URIs"** section
4. **List ALL redirect URIs currently configured:**
   - Write them down
   - Check each one carefully

### Step 3: Remove ALL Incorrect URIs

**Delete these if they exist:**
- ❌ `http://localhost:5173/api/zoho/callback` (wrong port)
- ❌ `http://localhost:3001/api/zoho/callback/` (trailing slash)
- ❌ `http://localhost:3001/api/zoho/callback ` (trailing space)
- ❌ ` https://localhost:3001/api/zoho/callback` (https or leading space)
- ❌ Any other variations

### Step 4: Add the CORRECT URI

1. In the "Authorized Redirect URIs" field, **type EXACTLY:**
   ```
   http://localhost:3001/api/zoho/callback
   ```

2. **Copy-paste this EXACT text** (don't type it manually to avoid typos):
   ```
   http://localhost:3001/api/zoho/callback
   ```

3. **Verify before saving:**
   - Starts with: `http://` (not `https://`)
   - Port is: `3001` (not `5173`)
   - Ends with: `callback` (not `callback/` or `callback `)
   - No spaces anywhere
   - Total length: 39 characters

### Step 5: Save and Wait

1. Click **"Save"** or **"Update"**
2. **Wait 60 seconds** (Zoho needs time to propagate changes globally)
3. Don't try again immediately - wait the full 60 seconds

### Step 6: Verify After Saving

1. Refresh the Zoho Developer Console page
2. Click "Edit" again
3. Check "Authorized Redirect URIs"
4. **Verify it shows EXACTLY:**
   ```
   http://localhost:3001/api/zoho/callback
   ```
5. Make sure there are NO other redirect URIs listed

### Step 7: Test Again

1. Go to your application Settings → Zoho Invoice Integration
2. Click **"Connect to Zoho"**
3. It should work now!

## 🚨 Common Mistakes

### Mistake 1: Multiple Redirect URIs
**Problem:** You have BOTH the old (5173) and new (3001) URI  
**Fix:** Remove the 5173 one, keep ONLY the 3001 one

### Mistake 2: Wrong Application
**Problem:** You're editing a different Zoho application  
**Fix:** Verify Client ID matches: `1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME`

### Mistake 3: Not Waiting
**Problem:** You saved but tried immediately  
**Fix:** Wait 60 seconds after saving before testing

### Mistake 4: Trailing Slash
**Problem:** Added `http://localhost:3001/api/zoho/callback/`  
**Fix:** Remove the trailing slash: `http://localhost:3001/api/zoho/callback`

### Mistake 5: Wrong Protocol
**Problem:** Using `https://` instead of `http://`  
**Fix:** Use `http://` for localhost

## 🔬 Verification Checklist

Before testing, verify in Zoho Developer Console:

- [ ] Application Client ID matches: `1000.UUD4C6OWU3NYRL9SJDPDIUGVS2E7ME`
- [ ] Only ONE redirect URI is configured
- [ ] Redirect URI is exactly: `http://localhost:3001/api/zoho/callback`
- [ ] No trailing slash
- [ ] No leading or trailing spaces
- [ ] Uses `http://` not `https://`
- [ ] Port is `3001` not `5173`
- [ ] Saved the changes
- [ ] Waited 60 seconds after saving

## 📞 Still Not Working?

If you've verified everything above and it still doesn't work:

1. **Check server logs** when you click "Connect to Zoho"
   - Look for: `[Zoho Routes] Redirect URI: ...`
   - Verify it matches what's in Zoho

2. **Try creating a new Zoho application:**
   - Create a fresh application in Zoho Developer Console
   - Add the redirect URI from the start
   - Use the new Client ID and Secret

3. **Check Zoho region:**
   - Make sure you're editing the application in the correct Zoho region
   - If your account is in Zoho.eu, Zoho.in, etc., make sure you're in the right console

4. **Contact Zoho support** if the issue persists

## ✅ Expected Result

After fixing, when you click "Connect to Zoho":
- ✅ No "Invalid Redirect Uri" error
- ✅ Redirects to Zoho login page
- ✅ After authorization, redirects back to your app
- ✅ Tokens are saved automatically

