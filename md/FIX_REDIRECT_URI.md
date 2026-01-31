# Fix Zoho Redirect URI Error

## Problem
You're getting this error:
```
Invalid Redirect Uri
Redirect URI passed does not match with the one configured
```

Zoho only accepts redirect URIs that are **exactly** listed in your app’s Authorized Redirect URIs. The URL the server sends must match character-for-character (including `https` vs `http`, no trailing slash).

## Solution

### Option A: Set ZOHO_REDIRECT_URI on the server (recommended for production)

1. In **Zoho Developer Console** → your app → **Authorized Redirect URIs**, add exactly one URL, e.g.:
   ```
   https://booktifisupabase-production.up.railway.app/api/zoho/callback
   ```
   (Use your real Railway backend URL; no trailing slash.)

2. On **Railway** (or your server), set the same URL in the environment:
   ```
   ZOHO_REDIRECT_URI=https://booktifisupabase-production.up.railway.app/api/zoho/callback
   ```
   Use the **exact** same string as in Zoho.

3. Redeploy the backend and try “Reconnect Zoho” again.

This way the server always sends the same redirect URI that Zoho expects.

### Option B: Add the server’s redirect URI to Zoho

1. Check what redirect URI the server is sending: look at **Railway logs** when you click “Reconnect Zoho”. You should see a line like:
   ```
   [Zoho Routes] Redirect URI (must be in Zoho Console): https://...
   ```
2. In **Zoho Developer Console** → your app → **Authorized Redirect URIs**, add that **exact** URL (copy-paste, no trailing slash).
3. Save and wait 10–30 seconds, then try again.

---

### Step 1: Update Zoho Developer Console (local / manual)

1. **Go to Zoho Developer Console**
   - Visit: https://api-console.zoho.com/
   - Sign in with your Zoho account

2. **Find Your Application**
   - Look for the client application with Client ID: `1000.11W8WXV5NH...`
   - Click on it to open the details

3. **Edit Authorized Redirect URIs**
   - Click "Edit" or "Settings" button
   - Find the "Authorized Redirect URIs" section
   - Add this exact URI:
     ```
     http://localhost:3001/api/zoho/callback
     ```
   - **Important**: Make sure there are no trailing slashes or extra spaces
   - Click "Save" or "Update"

4. **Wait for Propagation**
   - Wait 10-30 seconds for changes to propagate
   - Zoho may take a moment to update their servers

### Step 2: Test OAuth Flow

After updating the redirect URI in Zoho, try the OAuth flow again:

**Open this URL in your browser:**
```
http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
```

This should now work without the redirect URI error.

---

## Alternative: If You Can't Update Zoho Console

If you cannot update the Zoho Developer Console (e.g., you don't have access), you can update the application to match what's configured in Zoho:

1. **Check what redirect URI is configured in Zoho**
   - Look at the Zoho Developer Console
   - Note the exact redirect URI(s) listed

2. **Update the environment variable**
   - Edit `project/server/.env`
   - Add or update:
     ```env
     ZOHO_REDIRECT_URI=<the_exact_uri_from_zoho>
     ```
   - For example, if Zoho has `http://localhost:3001/zoho/callback`, use that

3. **Restart the server**
   - Stop the server (Ctrl+C)
   - Start it again: `npm run dev`

4. **Update the callback route** (if needed)
   - If the redirect URI doesn't match `/api/zoho/callback`, you may need to update the route in `project/server/src/routes/zoho.ts`

---

## Production (Netlify + Railway)

When the frontend is on **Netlify** and the backend on **Railway**, Zoho must redirect to the **backend (Railway)** URL, not the Netlify URL. The app now uses the backend’s own URL for the redirect URI.

**Add your Railway callback URL to Zoho Developer Console:**

1. In Zoho Developer Console → your app → **Authorized Redirect URIs**
2. Add (replace with your real Railway host):
   ```
   https://<your-railway-app>.up.railway.app/api/zoho/callback
   ```
   Example: `https://booktifisupabase-production.up.railway.app/api/zoho/callback`
3. Save. After that, “Reconnect Zoho” from the Netlify site should show the success screen instead of the landing page.

---

## Current Configuration

- **Client ID**: `1000.11W8WXV5NHQZK87XTN54UNREEVFTEW`
- **Redirect URI**: `http://localhost:3001/api/zoho/callback`
- **Scopes**: `ZohoInvoice.invoices.CREATE`, `ZohoInvoice.invoices.READ`, `ZohoInvoice.invoices.UPDATE`

---

## Verification

After updating, you can verify the configuration by running:
```bash
cd project/server
node scripts/check-redirect-uri.js
```

This will show you the current redirect URI configuration.

---

## Common Issues

### Issue: "Redirect URI mismatch" persists after update
- **Solution**: Wait a bit longer (up to 1 minute) for Zoho to propagate changes
- **Solution**: Make sure there are no typos or extra characters in the redirect URI
- **Solution**: Try clearing browser cache and cookies

### Issue: Multiple redirect URIs in Zoho
- **Solution**: You can have multiple redirect URIs. Just make sure `http://localhost:3001/api/zoho/callback` is one of them.

### Issue: Using different port
- **Solution**: If your server runs on a different port (not 3001), update both:
  - The redirect URI in Zoho Developer Console
  - The `ZOHO_REDIRECT_URI` environment variable

