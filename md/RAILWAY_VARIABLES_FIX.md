# Railway Environment Variables - Fix Required

## Current Variables (What You Have)

```
✅ SUPABASE_SERVICE_ROLE_KEY (correct - backend uses this)
⚠️ VITE_API_URL (frontend variable, not needed in backend)
⚠️ VITE_QR_SECRET (frontend variable, not needed in backend)
⚠️ VITE_SUPABASE_ANON_KEY (frontend variable, not needed in backend)
⚠️ VITE_SUPABASE_URL (backend has fallback, but should use SUPABASE_URL)
❌ JWT_SECRET (MISSING - critical for authentication!)
```

## Required Backend Variables

The backend needs these variables **WITHOUT** the `VITE_` prefix:

### Critical (Must Add):

```env
JWT_SECRET=your-secret-key-change-in-production
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
NODE_ENV=production
APP_URL=https://bookati-2jy1.bolt.host
```

### Already Correct:

```env
SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

## Why VITE_ Variables Don't Work for Backend

- `VITE_` prefix is for **Vite frontend** - exposes variables to browser
- **Backend (Node.js)** doesn't use Vite, so it ignores `VITE_*` variables
- Backend code looks for: `process.env.JWT_SECRET`, `process.env.SUPABASE_URL`, etc.

## How to Fix in Railway

### Step 1: Add Missing Variables

Click **"New Variable"** and add these:

1. **JWT_SECRET**
   ```
   Name: JWT_SECRET
   Value: your-secret-key-change-in-production
   ```
   ⚠️ **Important**: This must match the JWT_SECRET in your Bolt frontend!

2. **SUPABASE_URL** (without VITE_ prefix)
   ```
   Name: SUPABASE_URL
   Value: https://pivmdulophbdciygvegx.supabase.co
   ```

3. **NODE_ENV**
   ```
   Name: NODE_ENV
   Value: production
   ```

4. **APP_URL** (for Zoho redirects)
   ```
   Name: APP_URL
   Value: https://bookati-2jy1.bolt.host
   ```

### Step 2: Keep or Remove VITE_ Variables

**Option A: Keep them** (backend has fallbacks)
- Backend code has: `process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL`
- So it will work, but not ideal

**Option B: Remove them** (recommended for backend-only deployment)
- Backend doesn't need VITE_ variables
- Cleaner configuration
- Remove: `VITE_API_URL`, `VITE_QR_SECRET`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`

**Recommendation**: Keep `VITE_SUPABASE_URL` as fallback, remove the others

### Step 3: Verify VITE_API_URL Value

If you keep `VITE_API_URL`, make sure it's set to:
```
https://booktifisupabase-production.up.railway.app/api
```

But the backend doesn't actually need this - it's for the frontend.

## Final Railway Variables (Backend)

After adding the missing variables, you should have:

```env
✅ SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
✅ SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
✅ JWT_SECRET=your-secret-key-change-in-production
✅ NODE_ENV=production
✅ APP_URL=https://bookati-2jy1.bolt.host
```

Optional (backend has fallbacks, but can keep):
```env
VITE_SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
```

Can remove (not needed for backend):
```env
❌ VITE_API_URL (not used by backend)
❌ VITE_QR_SECRET (not used by backend)
❌ VITE_SUPABASE_ANON_KEY (backend uses SERVICE_ROLE_KEY)
```

## Backend Code Reference

The backend looks for these variables:

**File: `server/src/db.ts`**
```typescript
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
```

**File: `server/src/routes/tenants.ts`** (and others)
```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
```

**File: `server/src/index.ts`**
```typescript
const PORT = process.env.PORT || 3001;
```

## After Adding Variables

1. **Save** the new variables
2. Railway will automatically **redeploy**
3. **Watch the logs** for:
   ```
   ✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
      Using: SERVICE_ROLE key (bypasses RLS)
   🚀 API Server running on http://localhost:8080
   ```

4. **Test** the endpoint:
   ```bash
   curl https://booktifisupabase-production.up.railway.app/health
   ```
   Should return: `{"status":"ok","database":"connected"}`

## Common Issues

### Issue: "Missing Supabase configuration"
**Solution**: Add `SUPABASE_URL` (without VITE_ prefix)

### Issue: JWT verification fails / 401 errors
**Solution**: Add `JWT_SECRET` and ensure it matches Bolt frontend

### Issue: Backend still doesn't start
**Solution**: Check Railway logs for specific error messages

## Summary

**Add these 4 variables:**
1. `JWT_SECRET` ← CRITICAL (missing!)
2. `SUPABASE_URL` ← Recommended
3. `NODE_ENV` ← Best practice
4. `APP_URL` ← For Zoho integration

**Keep:**
- `SUPABASE_SERVICE_ROLE_KEY` ✅

**Can remove (not needed for backend):**
- `VITE_API_URL`
- `VITE_QR_SECRET`
- `VITE_SUPABASE_ANON_KEY`

After adding variables, Railway will redeploy automatically and the backend should start correctly!
