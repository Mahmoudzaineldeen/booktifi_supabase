# Bolt Cache Fix - Direct Supabase Calls Issue

## Problem

Bolt is showing errors indicating:
1. **Direct Supabase REST calls** - `https://pivmdulophbdciygvegx.supabase.co/rest/v1/bookings`
2. **Invalid filter syntax** - `created_at__gte=eq.2026-01-17...` (should be `created_at=gte.2026-01-17...`)
3. **localhost:3001 references** - `http://localhost:3001/api/tenants/smtp-settings`

## Root Cause

**Cached/old frontend build in Bolt** - The frontend code is using an outdated build that:
- Still has direct Supabase client calls
- Has hardcoded `localhost:3001` URLs
- Uses old query builder that constructs invalid URLs

## Solution

### Step 1: Code Fixes (Already Done)

✅ **Fixed ReceptionPage.tsx:**
- Changed `import { supabase }` to `import { db }`
- Changed `supabase.from()` to `db.from()`
- All queries now go through backend API

### Step 2: Clear Bolt Cache

**In Bolt/WebContainer:**

1. **Hard Refresh Browser:**
   - Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or open DevTools → Right-click refresh button → "Empty Cache and Hard Reload"

2. **Clear Browser Storage:**
   - Open DevTools (F12)
   - Go to Application tab → Storage
   - Click "Clear site data"
   - Check all boxes and click "Clear"

3. **Restart Bolt Environment:**
   - Close and reopen the Bolt project
   - This forces a fresh build

### Step 3: Verify Latest Code

**Check that you're using the latest code:**

1. **Verify in Bolt:**
   - Open `src/pages/reception/ReceptionPage.tsx`
   - Should show: `import { db } from '../../lib/db';`
   - Should NOT show: `import { supabase } from '../../lib/supabase';`

2. **Check Network Tab:**
   - Open DevTools → Network tab
   - Make a request (e.g., load bookings)
   - Should see requests to: `https://booktifisupabase-production.up.railway.app/api/query`
   - Should NOT see requests to: `https://pivmdulophbdciygvegx.supabase.co/rest/v1/...`

### Step 4: Rebuild Frontend (If Needed)

If cache clearing doesn't work:

1. **In Bolt Terminal:**
   ```bash
   # Stop the dev server (Ctrl+C)
   # Clear node_modules and rebuild
   rm -rf node_modules
   npm install
   npm run dev
   ```

2. **Or restart Bolt completely:**
   - Close Bolt
   - Reopen project
   - Wait for fresh build

## Expected Behavior After Fix

✅ **All database queries:**
- Go through: `https://booktifisupabase-production.up.railway.app/api/query`
- Use POST method with JSON body
- Include proper authentication headers

✅ **No direct Supabase calls:**
- No requests to `*.supabase.co/rest/v1/...`
- All queries routed through backend

✅ **Correct filter syntax:**
- Backend converts `created_at__gte` to `.gte('created_at', value)`
- No more "column does not exist" errors

✅ **No localhost:3001:**
- All API calls use Railway URL
- `getApiUrl()` returns Railway URL in Bolt

## Verification Checklist

- [ ] Hard refresh browser (Ctrl+Shift+R)
- [ ] Clear browser storage/cache
- [ ] Verify ReceptionPage.tsx uses `db` not `supabase`
- [ ] Check Network tab - should see Railway API calls
- [ ] No direct Supabase REST calls in Network tab
- [ ] No localhost:3001 in Network tab
- [ ] Stats/charts load without errors
- [ ] Tenant settings page works (no 401 errors)

## If Issues Persist

1. **Check Bolt Console:**
   - Look for `[getApiUrl]` logs
   - Should show: "Using VITE_API_URL: https://booktifisupabase-production.up.railway.app/api"

2. **Verify Environment Variables in Bolt:**
   - `VITE_API_URL` should be: `https://booktifisupabase-production.up.railway.app/api`
   - Check Bolt project settings → Environment Variables

3. **Check Backend Logs:**
   - Railway dashboard → Logs
   - Should see incoming requests from Bolt

4. **Force Rebuild:**
   - Delete `.vite` folder in Bolt
   - Restart dev server

---

**Status:** Code fixes applied ✅  
**Action Required:** Clear Bolt cache and verify latest code is running
