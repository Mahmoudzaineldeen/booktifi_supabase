# Bolt Deployment Guide - Complete Solution

## Quick Start: Deploy Backend to Railway

### Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub
3. Create new project

### Step 2: Deploy Backend
1. **New Project** → **Deploy from GitHub repo**
2. **Select Repository:** `Mahmoudzaineldeen/booktifi_supabase`
3. **Root Directory:** `server`
4. **Start Command:** `npm run dev` (or `npm start` for production)

### Step 3: Configure Environment Variables

In Railway dashboard → Your service → Variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-secret-key-change-in-production
APP_URL=https://bookati-2jy1.bolt.host
PORT=3001
NODE_ENV=production
```

### Step 4: Get Backend URL
- Railway provides URL: `https://your-project.railway.app`
- Your API will be at: `https://your-project.railway.app/api`

### Step 5: Update Bolt Environment Variables

In Bolt dashboard → Environment Variables:

```env
VITE_API_URL=https://your-project.railway.app/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Step 6: Configure CORS on Backend

**File: `server/src/index.ts`** - Already configured to allow all origins:

```typescript
const corsOptions = {
  origin: true, // ✅ Allows all origins (including Bolt)
  credentials: true,
};
```

### Step 7: Test

1. **Check backend health:**
   ```
   https://your-project.railway.app/health
   ```
   Should return: `{ "status": "ok", "database": "connected" }`

2. **Test in Bolt:**
   - Open https://bookati-2jy1.bolt.host
   - Check browser console - should see API calls to Railway backend
   - No more 404/401 errors

## Alternative: Render Deployment

### Step 1: Create Render Account
1. Go to https://render.com
2. Sign up with GitHub

### Step 2: Create Web Service
1. **New** → **Web Service**
2. **Connect GitHub** → Select repository
3. **Settings:**
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node

### Step 3: Environment Variables
Same as Railway (see above)

### Step 4: Get URL
- Render provides: `https://your-service.onrender.com`
- API: `https://your-service.onrender.com/api`

## Alternative: Fly.io Deployment

### Step 1: Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### Step 2: Create Fly App
```bash
cd server
fly launch
```

### Step 3: Set Secrets
```bash
fly secrets set SUPABASE_URL=...
fly secrets set SUPABASE_SERVICE_ROLE_KEY=...
fly secrets set JWT_SECRET=...
fly secrets set APP_URL=https://bookati-2jy1.bolt.host
```

### Step 4: Deploy
```bash
fly deploy
```

## Code Changes Required

### Minimal Changes (Recommended)

**File: `src/lib/db.ts`** - Update `getApiUrl()`:

```typescript
const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isBolt = hostname.includes('bolt.host') || 
                   hostname.includes('webcontainer');
    
    if (isBolt) {
      // Use deployed backend URL from environment
      const deployedUrl = import.meta.env.VITE_API_URL;
      if (deployedUrl) {
        console.log('[db] Bolt detected, using deployed backend:', deployedUrl);
        return deployedUrl;
      }
      // Fallback: hardcode your deployed URL
      return 'https://your-project.railway.app/api';
    }
  }
  
  // Local development
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};
```

**File: `src/pages/tenant/SettingsPage.tsx`** - Update `getApiUrl()`:

```typescript
const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isBolt = hostname.includes('bolt.host') || 
                   hostname.includes('webcontainer');
    
    if (isBolt) {
      // Use deployed backend
      return import.meta.env.VITE_API_URL || 'https://your-project.railway.app/api';
    }
  }
  
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};
```

**File: `vite.config.ts`** - Update proxy target:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        // In Bolt, this won't be used (frontend uses absolute URL)
        // But keep for local development
        target: process.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

## Verification Steps

### 1. Backend Health Check
```bash
curl https://your-project.railway.app/health
# Should return: {"status":"ok","database":"connected"}
```

### 2. Test API Endpoint
```bash
curl https://your-project.railway.app/api/health
# Should return: {"status":"ok","database":"connected"}
```

### 3. Check Backend Logs
In Railway/Render dashboard → Logs:
- Should see: `🚀 API Server running on port 3001`
- Should see: `✅ Supabase client initialized`

### 4. Test in Bolt
1. Open https://bookati-2jy1.bolt.host
2. Open browser DevTools → Network tab
3. Check API calls:
   - ✅ Should go to `https://your-project.railway.app/api/...`
   - ❌ Should NOT go to `http://localhost:3001/api/...`
4. Check console:
   - ✅ Should see: `[db] Bolt detected, using deployed backend: ...`
   - ❌ Should NOT see connection errors

## Troubleshooting

### Backend Returns 404
- **Check:** Root directory is set to `server/` in deployment platform
- **Check:** Start command is correct (`npm run dev` or `npm start`)
- **Check:** Port is set correctly (Railway auto-assigns, Render uses PORT env var)

### CORS Errors
- **Check:** Backend CORS allows all origins (already configured)
- **Check:** Backend URL is correct (no trailing slash)
- **Check:** Frontend is using HTTPS for deployed backend

### 401 Unauthorized
- **Check:** `JWT_SECRET` matches between frontend token generation and backend
- **Check:** Token is being sent in `Authorization: Bearer <token>` header
- **Check:** Backend logs show JWT verification errors

### Database Connection Errors
- **Check:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- **Check:** Backend logs show: `✅ Supabase client initialized`
- **Check:** Service role key (not anon key) is used

## Cost Estimates

### Railway
- **Free Tier:** $5 credit/month
- **Hobby Plan:** $5/month (if free tier exceeded)
- **Backend:** ~$5-10/month for small app

### Render
- **Free Tier:** Available (with limitations)
- **Starter Plan:** $7/month
- **Backend:** ~$7-15/month

### Fly.io
- **Free Tier:** 3 shared VMs
- **Paid:** $1.94/month per VM
- **Backend:** ~$2-5/month

## Next Steps After Deployment

1. ✅ Backend deployed and accessible
2. ✅ `VITE_API_URL` set in Bolt
3. ✅ Test all features work
4. ✅ Monitor backend logs for errors
5. ✅ Set up error monitoring (Sentry, etc.)

## Summary

**Problem:** Bolt doesn't run backend → all `/api/*` routes fail.

**Solution:** Deploy backend externally → update frontend to use deployed URL.

**Result:** ✅ All features work in Bolt, no code architecture changes needed.
