# Railway Variables - Final Configuration Check

## ✅ Current Variables (What You Have Now)

```
✅ APP_URL
✅ JWT_SECRET (CRITICAL - now added!)
✅ NODE_ENV
✅ SUPABASE_SERVICE_ROLE_KEY
⚠️ VITE_API_URL (not needed for backend, but won't hurt)
⚠️ VITE_QR_SECRET (not needed for backend, but won't hurt)
⚠️ VITE_SUPABASE_ANON_KEY (backend uses SERVICE_ROLE_KEY instead)
✅ VITE_SUPABASE_URL (backend has fallback to use this)
```

## Status: SHOULD WORK NOW ✅

Your backend **should work** because:

1. ✅ **JWT_SECRET** is now set (was the critical missing variable)
2. ✅ **SUPABASE_SERVICE_ROLE_KEY** is set
3. ✅ **VITE_SUPABASE_URL** will work as fallback

The backend code has this fallback:
```typescript
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
```

So it will use `VITE_SUPABASE_URL` if `SUPABASE_URL` is not set.

## Optional: Add SUPABASE_URL (Best Practice)

For clarity and best practices, you can also add:

**New Variable:**
```
Name: SUPABASE_URL
Value: https://pivmdulophbdciygvegx.supabase.co
```

(Same value as VITE_SUPABASE_URL)

This makes it clearer which variables are for backend vs frontend, but it's **not required** since the fallback works.

## Next Steps

### 1. Check if Railway is Redeploying

After adding variables, Railway should automatically redeploy.

Check: **Deployments** tab → Latest deployment should show "Deploying..."

### 2. Watch the Logs

Go to **Logs** tab and watch for:

**Success looks like:**
```
[Build] Building...
[Build] Installing dependencies...
[Deploy] Starting with: npm run dev
[Deploy] > tsx watch src/index.ts
[Deploy] 
[Deploy] ✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
[Deploy]    Using: SERVICE_ROLE key (bypasses RLS)
[Deploy] ✅ Database connection successful
[Deploy] 🚀 API Server running on http://localhost:8080
[Deploy] 📊 Database: pivmdulophbdciygvegx
```

**If you see errors:**
- "Missing Supabase configuration" → Add SUPABASE_URL
- "JWT_SECRET undefined" → Check JWT_SECRET is set
- "Cannot find module" → Dependencies issue

### 3. Verify Root Directory Setting

Make sure in **Settings** tab:

**Root Directory:** `server` (NOT `/server`)

If it still has `/server`, change it to just `server` and redeploy.

### 4. Test the Backend

Once deployment is complete, test:

```bash
# Health check
curl https://booktifisupabase-production.up.railway.app/health
```

**Expected response (JSON):**
```json
{"status":"ok","database":"connected"}
```

**If you get HTML instead:**
- Root directory is wrong
- Backend didn't start
- Check Railway logs for errors

### 5. Test API Endpoint

```bash
curl https://booktifisupabase-production.up.railway.app/api/health
```

**Expected response:**
```json
{"status":"ok","database":"connected"}
```

### 6. Test Root Endpoint

```bash
curl https://booktifisupabase-production.up.railway.app/
```

**Expected response:**
```json
{
  "message": "Bookati API Server",
  "version": "1.0.0",
  "status": "running",
  "endpoints": {
    "health": "/health",
    "apiHealth": "/api/health",
    "auth": "/api/auth",
    "customers": "/api/customers",
    "bookings": "/api/bookings",
    "tenants": "/api/tenants"
  }
}
```

## If Backend Still Returns HTML

### Check These Settings:

1. **Root Directory** = `server` (no slash)
2. **Start Command** = `npm run dev`
3. **Config Files** = Check `server/railway.toml` and `server/nixpacks.toml` exist

### Force Redeploy:

1. Go to **Deployments** tab
2. Click **"⋮"** menu on latest deployment
3. Click **"Redeploy"**
4. Watch logs in real-time

## Environment Variables Summary

### Backend Needs (You Have):
- ✅ JWT_SECRET
- ✅ SUPABASE_SERVICE_ROLE_KEY
- ✅ SUPABASE_URL (via VITE_SUPABASE_URL fallback)
- ✅ NODE_ENV
- ✅ APP_URL

### Can Remove (Not Used by Backend):
- VITE_API_URL (backend doesn't need this)
- VITE_QR_SECRET (backend doesn't need this)
- VITE_SUPABASE_ANON_KEY (backend uses SERVICE_ROLE_KEY)

### Should Keep:
- VITE_SUPABASE_URL (backend uses as fallback)

## Verification Checklist

After Railway deployment completes:

- [ ] Railway logs show "🚀 API Server running"
- [ ] No "Missing Supabase configuration" errors
- [ ] No "JWT_SECRET undefined" errors
- [ ] `/health` returns JSON (not HTML)
- [ ] `/api/health` returns JSON
- [ ] Backend is accessible from Bolt

## Once Backend Works

Set these variables in **Bolt** environment:

```env
VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
VITE_SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
JWT_SECRET=your-secret-key-change-in-production
```

**Important:** `JWT_SECRET` must match between Railway and Bolt!

## Expected Result

With all variables set correctly:
- ✅ Backend starts successfully on Railway
- ✅ Returns JSON responses (not HTML)
- ✅ Bolt frontend can connect to Railway backend
- ✅ No 401, 404, or 400 errors
- ✅ Full project works in Bolt environment

## Next Action

**Right now:** Check Railway **Logs** tab to see if backend started successfully after adding variables.

If you see "🚀 API Server running", you're done! 🎉

If you see errors or HTML responses, share the logs and I'll help debug.
