# Railway Configuration Fix - Backend Only

## Problem

Your root `package.json` starts both frontend and backend:
```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:frontend\" \"npm:dev:backend\""
  }
}
```

Railway is serving HTML because it's either:
1. Running from the wrong directory (project root instead of `/server`)
2. Serving built frontend files instead of starting the Node.js backend

## Solution

### Step 1: Fix Root Directory in Railway

**Current setting**: `/server`  
**Should be**: `server` (no leading slash)

Railway paths are relative to repo root.

**How to change:**
1. Railway Dashboard → Your Service → **Settings**
2. Scroll to **Root Directory**
3. Change from `/server` to just `server`
4. Click **Update**

### Step 2: Verify Start Command

**Current**: `npm run dev` ✅ This is correct

**IF** you want to be more explicit:
```bash
npm install && npm run dev
```

This ensures dependencies are installed before starting.

### Step 3: Add Environment Variables

Make sure these are set in **Variables** tab:

```env
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<get-from-supabase-dashboard>
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
APP_URL=https://bookati-2jy1.bolt.host
PORT=8080
```

### Step 4: Add Healthcheck

In Railway Settings:
- **Healthcheck Path**: `/health`

### Step 5: Redeploy

1. Railway → **Deployments**
2. Click **"⋮"** menu → **"Redeploy"**
3. **Watch the logs** in real-time

## Expected Logs (Success)

```
============================================
[Build Phase]
============================================
Building in: /app/server
Detected: Node.js v22.22.0
Installing dependencies...
npm install
Dependencies installed successfully

============================================
[Deploy Phase]
============================================
Starting deployment...
Running: npm run dev
> bookati-server@1.0.0 dev
> tsx watch src/index.ts

✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
   Using: SERVICE_ROLE key (bypasses RLS)
✅ Database connection successful
🚀 API Server running on http://localhost:8080
📊 Database: pivmdulophbdciygvegx
ℹ️  Zoho credentials: Will be loaded from database per tenant
   Each tenant can configure their own Zoho credentials in Settings → Integrations

============================================
Deployment successful! ✅
============================================
```

## Bad Logs (Frontend Serving)

If you see this, Railway is serving static files:
```
Serving static content...
Listening on port 8080
```

Or this (wrong directory):
```
Error: Cannot find module 'vite'
Starting development server...
```

## Alternative: Create railway.json

If the above doesn't work, create explicit config:

**File: `server/railway.json`**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install"
  },
  "deploy": {
    "startCommand": "npm run dev",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

Then in Railway:
- **Settings** → **Config-as-code**
- **Add File Path**: `server/railway.json`

## Testing After Fix

Once redeployed with correct settings:

```bash
# Should return JSON (not HTML)
curl https://booktifisupabase-production.up.railway.app/health

# Expected:
{"status":"ok","database":"connected"}

# NOT:
<!doctype html>...
```

## Why This Happens

Your project structure:
```
project/
├── package.json          ← Starts BOTH frontend + backend
├── server/
│   ├── package.json      ← Starts ONLY backend
│   └── src/
│       └── index.ts      ← Express server
└── src/                  ← Frontend code
```

**For local dev**: Run `npm run dev` from **root** (starts both)  
**For Railway**: Deploy from **`server/`** directory (backend only)

## Verification Steps

1. ✅ Root Directory = `server` (not `/server`)
2. ✅ Start Command = `npm run dev`
3. ✅ All env vars set (especially `SUPABASE_SERVICE_ROLE_KEY`)
4. ✅ Healthcheck Path = `/health`
5. ✅ Redeploy and check logs
6. ✅ Test endpoint returns JSON

## Still Not Working?

If Railway logs show errors, check:

1. **Missing Dependencies**: 
   ```
   Error: Cannot find module 'tsx'
   ```
   → `tsx` should be in `server/package.json` devDependencies ✅ (it is)

2. **Wrong Directory**:
   ```
   Error: ENOENT: no such file or directory, open 'src/index.ts'
   ```
   → Root directory is wrong, should be `server`

3. **Environment Variables**:
   ```
   Missing Supabase configuration
   ```
   → Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

4. **Port Issues**:
   ```
   Error: listen EADDRINUSE: address already in use
   ```
   → Backend should use `process.env.PORT || 3001` ✅ (it does)

## Summary

**Fix in Railway:**
1. Root Directory: `server` (not `/server`)
2. Start Command: `npm run dev`
3. Add env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET)
4. Healthcheck Path: `/health`
5. Redeploy

**Result:** Backend starts correctly, returns JSON responses (not HTML)
