# Railway Deployment Issue - Diagnosis & Solution

## Problem Identified

The Railway backend at `https://booktifisupabase-production.up.railway.app` is returning HTML instead of JSON responses.

### Test Results

```
❌ Backend Health Endpoint: Returns HTML (<!doctype html>)
❌ API Health Endpoint: Returns HTML (<!doctype html>)
❌ Root Endpoint: Returns HTML (<!doctype html>)
✅ Environment Detection: Works correctly
✅ API URL Resolution: Works correctly
✅ Network Connectivity: 339ms latency
```

### Root Cause

Railway is serving the **frontend static files** instead of running the **backend Node.js server**.

This happens when:
1. The deployment points to the wrong directory
2. The start command is incorrect
3. Railway detects it as a static site instead of a Node.js app
4. The backend server failed to start

## Current Railway Configuration (from user)

```
Source Repository: Mahmoudzaineldeen/booktifi_supabase
Root Directory: /server
Branch: main
Start Command: npm run dev
Port: 8080
Region: US West (California, USA)
```

## Issues Found

### 1. Root Directory Mismatch
- **Current**: `/server`
- **Actual structure**: The backend code is in `server/` directory
- **Fix**: Root directory should be `server` (without leading slash) or left empty if deploying from root

### 2. Port Configuration
- **Current**: Port 8080
- **Backend expects**: Port 3001 (or Railway's auto-assigned PORT env var)
- **Fix**: Backend should use `process.env.PORT || 3001`

### 3. Start Command
- **Current**: `npm run dev`
- **Issue**: May not exist in package.json or points to frontend
- **Fix**: Should be `npm run dev` (for development) or `npm start` (for production)

### 4. Package.json Location
- **Issue**: Railway needs to find `package.json` in the root directory
- **Current**: If root is `/server`, package.json should be at `/server/package.json`

## Verification Steps

### Check Backend package.json
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc"
  }
}
```

### Check Backend is Node.js App
Railway should detect:
- `package.json` exists
- Node.js version specified (or default to latest LTS)
- Dependencies include Express, Supabase client

### Check Environment Variables
Required in Railway:
```env
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
PORT=<auto-assigned by Railway>
APP_URL=https://bookati-2jy1.bolt.host
```

## Solution

### Option 1: Fix Railway Deployment Settings

1. **Set Root Directory** in Railway:
   - Go to Railway dashboard → Your service → Settings
   - Set "Root Directory" to `server`
   - Or leave empty and set start command to `cd server && npm run dev`

2. **Verify Start Command**:
   - Should be: `npm run dev` (if in server directory)
   - Or: `cd server && npm run dev` (if root directory is empty)

3. **Check Build Command**:
   - Should be empty (or `npm install`)
   - Railway auto-runs `npm install`

4. **Verify Port**:
   - Backend should use `process.env.PORT || 3001`
   - Railway automatically assigns PORT env var

5. **Redeploy**:
   - Trigger a new deployment
   - Check logs for "🚀 API Server running on..."

### Option 2: Deploy Backend to Different Service

Create a separate Railway service for backend:

1. **New Service**: Create new service in Railway
2. **Connect Repo**: Same repo, but configure differently
3. **Root Directory**: `server`
4. **Start Command**: `npm run dev`
5. **Environment Variables**: Add all required vars
6. **Deploy**: Railway will detect Node.js and start correctly

### Option 3: Use Railway Template

1. Go to Railway dashboard
2. Create "New Project"
3. Select "Deploy from GitHub"
4. Choose repository
5. Railway asks: "Where is your app?"
6. Select: `server/` directory
7. Railway auto-detects Node.js
8. Add environment variables
9. Deploy

## Expected Behavior After Fix

### Health Check
```bash
curl https://booktifisupabase-production.up.railway.app/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "database": "connected"
}
```

### API Health
```bash
curl https://booktifisupabase-production.up.railway.app/api/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Root Endpoint
```bash
curl https://booktifisupabase-production.up.railway.app/
```

**Expected Response:**
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

## Verification Commands

After fixing Railway deployment:

```bash
# Test health
curl https://booktifisupabase-production.up.railway.app/health

# Test API
curl https://booktifisupabase-production.up.railway.app/api/health

# Test with token (replace with actual token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://booktifisupabase-production.up.railway.app/api/tenants

# Check Railway logs
railway logs
```

## Railway Logs to Check

Look for:
```
✅ Supabase client initialized
🚀 API Server running on http://localhost:<PORT>
📊 Database: <project-id>
✅ Zoho credentials: Will be loaded from database per tenant
```

If you see:
```
❌ Missing Supabase configuration
❌ Cannot find module 'express'
❌ Error: ENOENT: no such file or directory
```

Then:
- Environment variables not set
- Dependencies not installed
- Wrong directory

## Current Status

🔴 **Backend Not Running**
- Railway is serving static HTML files
- Node.js server is not started
- API endpoints return HTML instead of JSON

## Next Steps

1. **Check Railway Dashboard**:
   - Go to Railway project
   - Click on the service
   - Check "Deployments" tab for errors
   - Check "Logs" for startup errors

2. **Fix Configuration**:
   - Set root directory to `server`
   - Verify start command is `npm run dev`
   - Add all environment variables

3. **Redeploy**:
   - Trigger new deployment
   - Watch logs for successful startup

4. **Verify**:
   - Run tests again
   - All health checks should return JSON

## Alternative: Deploy Backend Separately

If Railway continues serving frontend:

1. Create **new Railway service** specifically for backend
2. Point it to `server/` directory
3. Configure as Node.js app (not static site)
4. Deploy
5. Get new URL
6. Update `VITE_API_URL` in frontend Bolt environment

## Contact Support

If issues persist:
- Check Railway documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Verify deployment settings match Node.js app requirements
