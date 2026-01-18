# ✅ Code Pushed to GitHub - Next Steps in Railway

## Files Successfully Committed & Pushed

✅ `server/railway.toml` - Railway deployment configuration  
✅ `server/nixpacks.toml` - Build configuration  
✅ `src/lib/apiUrl.ts` - Centralized API URL utility  
✅ Updated frontend files to use Railway backend  
✅ Comprehensive documentation files  

## Next Steps: Configure Railway

### 1. Go to Railway Dashboard

https://railway.app/dashboard

Click on your **booktifi_supabase** service

### 2. Update Settings

Go to **Settings** tab and make these changes:

#### Root Directory
**Change from**: `/server`  
**Change to**: `server` ← (no leading slash!)

#### Start Command
**Should be**: `npm run dev` ✅ (already correct)

#### Healthcheck Path
**Add**: `/health`

### 3. Add Environment Variables

Go to **Variables** tab and add these:

```env
SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<get-this-from-supabase>
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
APP_URL=https://bookati-2jy1.bolt.host
```

#### How to Get SUPABASE_SERVICE_ROLE_KEY:
1. Go to: https://supabase.com/dashboard
2. Select your project
3. Settings → API
4. Copy the **"service_role"** key (NOT the anon key)
5. Paste it in Railway Variables

### 4. Redeploy

1. Go to **Deployments** tab
2. Click **"⋮"** menu on latest deployment
3. Click **"Redeploy"**
4. Watch the logs in real-time

### 5. Watch for Success in Logs

You should see:

```
[Build] Building in: /app/server
[Build] Detected nixpacks.toml
[Build] Using Node.js 22.x
[Build] Installing dependencies...
[Build] Build complete ✓

[Deploy] Starting with: npm run dev
[Deploy] > tsx watch src/index.ts
[Deploy] 
[Deploy] ✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
[Deploy]    Using: SERVICE_ROLE key (bypasses RLS)
[Deploy] ✅ Database connection successful
[Deploy] 🚀 API Server running on http://localhost:8080
[Deploy] 📊 Database: pivmdulophbdciygvegx
[Deploy] 
[Deploy] Deployment successful! ✅
```

### 6. Test the Deployment

After Railway shows "Deployment successful":

```bash
curl https://booktifisupabase-production.up.railway.app/health
```

**Expected response (JSON):**
```json
{"status":"ok","database":"connected"}
```

**NOT this (HTML):**
```html
<!doctype html>...
```

### 7. Test API Endpoint

```bash
curl https://booktifisupabase-production.up.railway.app/api/health
```

**Expected response:**
```json
{"status":"ok","database":"connected"}
```

### 8. Set Environment Variables in Bolt

Once Railway backend is working, set these in Bolt:

```env
VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
VITE_SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

## Troubleshooting

### If Still Serving HTML:

Check Railway logs for errors:
- ❌ "Cannot find module" → Dependencies not installed
- ❌ "Missing Supabase configuration" → Env vars not set
- ❌ "ENOENT: no such file" → Wrong directory

### If Server Crashes:

Check logs for:
- Missing `SUPABASE_SERVICE_ROLE_KEY`
- Missing `SUPABASE_URL`
- Port conflicts

### If Can't Find Config Files:

Make sure:
- Files are in `server/` directory
- Files are committed and pushed
- Root Directory is set to `server` (not `/server`)

## Success Checklist

After Railway deployment:

- [ ] Railway logs show "🚀 API Server running"
- [ ] No "Cannot find module" errors
- [ ] `/health` returns JSON (not HTML)
- [ ] `/api/health` returns JSON
- [ ] Supabase connection successful
- [ ] No 500 errors in logs

Once all checkmarks are ✅, your backend is ready!

## Final Test

Run the integration test:

```bash
node test-railway-integration.js
```

All 8 tests should pass:
- ✅ Backend Health Endpoint
- ✅ API Health Endpoint
- ✅ Root Endpoint
- ✅ CORS Configuration
- ✅ Query Endpoint
- ✅ Environment Detection
- ✅ API URL Resolution
- ✅ Network Connectivity

## Need Help?

If Railway logs show errors, share the logs and I can help debug!

The config files (`railway.toml` and `nixpacks.toml`) should force Railway to deploy correctly.
