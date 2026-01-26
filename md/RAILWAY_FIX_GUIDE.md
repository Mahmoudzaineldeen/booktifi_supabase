# Railway Deployment Fix Guide

## Current Configuration Analysis

Your Railway settings are mostly correct:
- ✅ Root Directory: `/server` (correct)
- ✅ Start Command: `npm run dev` (correct)
- ✅ Port: 8080 (Railway will set PORT env var)
- ✅ Node version: 22.22.0 (correct)
- ⚠️ Issue: Serving HTML instead of JSON

## Problem Diagnosis

Railway is serving static HTML files instead of running the Express backend. This happens when:

1. **Backend server failed to start** (most likely)
2. **Static files in dist/public being served**
3. **Environment variables missing**
4. **Deployment errors not visible**

## Immediate Fixes

### Fix 1: Check Railway Logs (CRITICAL)

1. Go to Railway dashboard → Your service
2. Click **"Logs"** tab
3. Look for:
   - ❌ Errors during startup
   - ❌ "Missing Supabase configuration"
   - ❌ "Cannot find module"
   - ❌ Port binding errors
   - ✅ "🚀 API Server running on..."

**What to look for:**
```bash
# Good logs (server started):
✅ Supabase client initialized
🚀 API Server running on http://localhost:8080
📊 Database: pivmdulophbdciygvegx

# Bad logs (server failed):
❌ Missing Supabase configuration
❌ Error: Cannot find module 'express'
❌ SUPABASE_URL: Missing
```

### Fix 2: Verify Environment Variables

Go to Railway dashboard → Your service → **Variables** tab

**Required variables:**
```env
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
APP_URL=https://bookati-2jy1.bolt.host
```

**CRITICAL**: Check if `SUPABASE_SERVICE_ROLE_KEY` is set (not VITE_SUPABASE_ANON_KEY)

### Fix 3: Update Backend to Use Railway's PORT

Railway assigns a dynamic PORT. Your backend needs to use it:

**File: `server/src/index.ts`** (line ~29)
```typescript
const PORT = process.env.PORT || 3001;
```

This is correct, but verify Railway is setting PORT env var.

### Fix 4: Add Healthcheck Path

In Railway settings:
- **Healthcheck Path**: `/health`

This ensures Railway knows when the server is ready.

### Fix 5: Check Start Command Works Locally

Test in your local `server/` directory:
```bash
cd server
npm install
npm run dev
```

Should see:
```
🚀 API Server running on http://localhost:3001
```

If this fails locally, fix it before deploying.

## Detailed Troubleshooting Steps

### Step 1: Check Deployment Status

Railway dashboard → Deployments tab:
- Is latest deployment "Running" or "Failed"?
- Click on deployment to see logs
- Look for build errors

### Step 2: Check Build Output

Railway logs should show:
```
Building...
Installing dependencies...
npm install
...
Build complete
Starting...
```

If you see build errors, dependencies might be missing.

### Step 3: Verify package.json

**File: `server/package.json`**

Should have:
```json
{
  "name": "bookati-server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc"
  },
  "dependencies": {
    "express": "^4.18.2",
    "@supabase/supabase-js": "^2.86.2",
    // ... other dependencies
  }
}
```

### Step 4: Check for Static File Serving

Look for in `server/src/index.ts`:
```typescript
app.use(express.static('public')); // ❌ Remove this
app.use(express.static('dist'));   // ❌ Remove this
```

Backend should NOT serve static files.

### Step 5: Force Redeploy

After checking logs and fixing issues:
1. Railway dashboard → Deployments
2. Click "⋮" menu → "Redeploy"
3. Watch logs in real-time
4. Look for "🚀 API Server running"

## Common Issues & Solutions

### Issue 1: "Missing Supabase configuration"

**Solution:**
```bash
# In Railway Variables tab, add:
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
```

Get service role key:
- Supabase Dashboard → Settings → API
- Copy "service_role" key (NOT anon key)

### Issue 2: "Cannot find module 'tsx'"

**Solution:**
Add to `server/package.json` dependencies:
```json
{
  "dependencies": {
    "tsx": "^4.7.0"
  }
}
```

Then redeploy.

### Issue 3: Port Already in Use

**Solution:**
Backend already uses `process.env.PORT || 3001`, so this should work.

If Railway logs show port errors:
- Check no other service using same port
- Verify PORT env var is set by Railway

### Issue 4: Server Exits Immediately

**Logs show:**
```
Starting...
[Process exited]
```

**Solution:**
- Check for uncaught exceptions in startup
- Verify all required env vars are set
- Add logging to see where it fails

## Testing After Fix

After Railway deployment is fixed, test with:

```bash
# Test health endpoint
curl https://booktifisupabase-production.up.railway.app/health
# Should return: {"status":"ok","database":"connected"}

# Test API health
curl https://booktifisupabase-production.up.railway.app/api/health
# Should return: {"status":"ok","database":"connected"}

# Test root endpoint
curl https://booktifisupabase-production.up.railway.app/
# Should return: {"message":"Bookati API Server","version":"1.0.0","status":"running"}
```

All should return **JSON**, not HTML.

## Alternative: Deploy Fresh Service

If issues persist, create a new Railway service:

### Option A: Deploy from GitHub (Recommended)

1. Railway dashboard → New Project
2. Deploy from GitHub → Select your repo
3. When Railway asks "Detected multiple services":
   - Choose **"Deploy server/"**
4. Railway auto-detects Node.js
5. Add environment variables
6. Deploy

### Option B: Manual Configuration

1. Create new service in Railway
2. Connect to GitHub repo
3. Settings:
   - Root Directory: `server`
   - Start Command: `npm run dev`
   - Node version: 22.x
4. Add all environment variables
5. Deploy

## Environment Variables Checklist

In Railway Variables tab, you MUST have:

```env
✅ SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
✅ SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... (NOT the anon key)
✅ JWT_SECRET=your-secret-key-change-in-production
✅ NODE_ENV=production
✅ APP_URL=https://bookati-2jy1.bolt.host
```

Optional but recommended:
```env
ZOHO_CLIENT_ID=<if using Zoho>
ZOHO_CLIENT_SECRET=<if using Zoho>
ZOHO_REDIRECT_URI=https://bookati-2jy1.bolt.host/api/zoho/callback
```

## Expected Railway Logs (Success)

After deployment, logs should show:
```
[Build] Building...
[Build] Installing dependencies...
[Build] Build complete
[Deploy] Starting deployment...
[Deploy] ✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
[Deploy]    Using: SERVICE_ROLE key (bypasses RLS)
[Deploy] ✅ Database connection successful
[Deploy] 🚀 API Server running on http://localhost:8080
[Deploy] 📊 Database: pivmdulophbdciygvegx
[Deploy] ✅ Zoho credentials: Will be loaded from database per tenant
[Deploy] Deployment successful
```

## Next Steps

1. **Check Railway logs** (most important)
2. **Verify environment variables** are set
3. **Add healthcheck path**: `/health`
4. **Redeploy** and watch logs
5. **Test endpoints** should return JSON

Once Railway backend returns JSON responses, your Bolt frontend will work correctly.

## Quick Command to Test

```bash
# After Railway is fixed, run this test:
node test-railway-integration.js

# All 8 tests should pass:
# ✅ Backend Health Endpoint
# ✅ API Health Endpoint
# ✅ Root Endpoint
# ✅ CORS Configuration
# ✅ Query Endpoint Accessibility
# ✅ Environment Detection Logic
# ✅ API URL Resolution
# ✅ Network Connectivity
```

## Need Help?

If you share the Railway deployment logs, I can provide more specific guidance on what's failing.
