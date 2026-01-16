# Fix CORS Error - Complete Guide

## Problem
You're seeing CORS errors when the frontend tries to connect to the backend:
```
Access to fetch at 'https://tartly-matronal-burl.ngrok-free.dev/api/...' 
from origin 'http://localhost:5173' has been blocked by CORS policy
```

## Root Cause
The frontend is trying to use ngrok URL instead of localhost.

## Solution

### Step 1: Update Frontend .env File

1. **Create or edit** `project/.env` file in the project root
2. **Add or update** this line:
   ```env
   VITE_API_URL=http://localhost:3001/api
   ```
3. **Remove** any ngrok URLs from this file

### Step 2: Restart Frontend Dev Server

After updating `.env`, you MUST restart the frontend dev server:

```powershell
# Stop the current dev server (Ctrl+C)
# Then restart it:
cd project
npm run dev
```

**Important:** Vite caches environment variables, so restart is required!

### Step 3: Verify Backend Server is Running

Make sure the backend server is running on port 3001:

```powershell
cd project/server
npm run dev
```

You should see:
```
🚀 API Server running on http://localhost:3001
```

### Step 4: Test the Connection

1. Open browser console
2. Check that API calls now go to `http://localhost:3001/api` instead of ngrok
3. CORS errors should be gone

## Why This Works

1. **CORS is fixed** in `server/src/index.ts` - now allows all origins
2. **Using localhost** avoids ngrok rate limits and CORS issues
3. **No external dependencies** - everything runs locally

## If You Still See Errors

1. **Clear browser cache** - Hard refresh (Ctrl+Shift+R)
2. **Check backend is running** - Visit http://localhost:3001/health
3. **Verify .env file** - Make sure `VITE_API_URL=http://localhost:3001/api`
4. **Restart both servers** - Frontend AND backend

## For Production

When deploying to production:
- Set `VITE_API_URL` to your production API URL
- Update CORS in `server/src/index.ts` to only allow your production domain

