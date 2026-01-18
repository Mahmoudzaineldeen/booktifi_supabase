# Railway Backend Fix - Definitive Solution

## The Root Problem

Your root `package.json` has:
```json
"dev": "concurrently \"npm:dev:frontend\" \"npm:dev:backend\""
```

This starts **BOTH** frontend and backend - perfect for local development, but Railway needs to run **ONLY the backend**.

## Why Railway is Serving HTML

Railway is either:
1. Running from the **wrong package.json** (root instead of server/)
2. The `/server` path format is confusing Railway
3. Railway is finding built frontend files and serving those

## Definitive Fix

I've created two config files that **force** Railway to use the correct settings:

### Files Created:
1. ✅ `server/railway.toml` - Railway configuration
2. ✅ `server/nixpacks.toml` - Build configuration

These files explicitly tell Railway:
- Build in the server/ directory
- Use Node.js 22.x
- Run `npm install` then `npm run dev`
- Use `/health` for healthchecks

## Steps to Deploy

### Option 1: Use the Config Files (RECOMMENDED)

1. **Commit the new files**:
   ```bash
   git add server/railway.toml server/nixpacks.toml
   git commit -m "Add Railway config files for backend-only deployment"
   git push
   ```

2. **In Railway Dashboard** → Your Service → **Settings**:
   - **Root Directory**: Change to `server` (remove the `/`)
   - **Config-as-code** → **Railway Config File**: Enable and set to `server/railway.toml`

3. **Redeploy**:
   - Railway → Deployments → Redeploy

### Option 2: Manual Configuration (If config files don't work)

In Railway Dashboard → Settings:

1. **Root Directory**: 
   ```
   server
   ```
   (NOT `/server` - remove the leading slash)

2. **Start Command**:
   ```bash
   npm ci && npm run dev
   ```

3. **Build Command** (leave empty or set to):
   ```bash
   npm install
   ```

4. **Environment Variables** (Variables tab):
   ```env
   SUPABASE_URL=https://pivmdulophbdciygvegx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   JWT_SECRET=your-secret-key-change-in-production
   NODE_ENV=production
   APP_URL=https://bookati-2jy1.bolt.host
   ```

5. **Healthcheck Path**:
   ```
   /health
   ```

6. **Redeploy**

## How to Get SUPABASE_SERVICE_ROLE_KEY

This is critical - Railway needs this:

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Click **Settings** (gear icon) → **API**
4. Under "Project API keys", copy the **`service_role`** key
5. Paste it in Railway Variables as `SUPABASE_SERVICE_ROLE_KEY`

## Expected Results

After deploying with the config files, Railway logs should show:

```
============================================
[Build] Detected nixpacks.toml
[Build] Using Node.js 22.x
[Build] Working directory: /app/server
[Build] Running: npm install
[Build] Dependencies installed ✓

[Deploy] Starting with: npm run dev
[Deploy] > bookati-server@1.0.0 dev
[Deploy] > tsx watch src/index.ts
[Deploy] 
[Deploy] ✅ Supabase client initialized: https://pivmdulophbdciygvegx.supabase.co
[Deploy]    Using: SERVICE_ROLE key (bypasses RLS)
[Deploy] ✅ Database connection successful
[Deploy] 🚀 API Server running on http://localhost:8080
[Deploy] 📊 Database: pivmdulophbdciygvegx
[Deploy] ℹ️  Zoho credentials: Will be loaded from database per tenant
[Deploy] 
[Deploy] Deployment complete ✓
============================================
```

## Test After Deployment

```bash
# Should return JSON (not HTML)
curl https://booktifisupabase-production.up.railway.app/health

# Expected response:
{"status":"ok","database":"connected"}

# NOT this:
<!doctype html>
```

## If Still Serving HTML

Check Railway logs for:

### Error 1: "Cannot find module 'tsx'"
**Solution**: `tsx` is in devDependencies, Railway should install it. If not, move it to dependencies:
```bash
cd server
npm install --save tsx
git add package.json package-lock.json
git commit -m "Move tsx to dependencies for Railway"
git push
```

### Error 2: "Missing Supabase configuration"
**Solution**: Add environment variables in Railway (especially `SUPABASE_SERVICE_ROLE_KEY`)

### Error 3: Still serving HTML
**Solution**: Railway might be caching. Try:
1. Railway → Settings → Delete service
2. Create new service
3. Point to same repo
4. Set Root Directory to `server`
5. Deploy

## Alternative: Create Separate Backend Deployment

If the above doesn't work, create a **new Railway service** specifically for backend:

1. Railway Dashboard → **New Project**
2. **Deploy from GitHub** → Select your repo
3. Railway detects multiple services:
   - Choose **"Deploy server/"** or manually configure
4. Set environment variables
5. Deploy

This ensures Railway treats it as a fresh backend-only deployment.

## Verification Checklist

After deployment:

- [ ] Railway logs show "🚀 API Server running"
- [ ] No HTML in logs
- [ ] `/health` returns JSON
- [ ] `/api/health` returns JSON
- [ ] No "Cannot find module" errors
- [ ] Supabase connection successful

## Why Config Files Help

The `railway.toml` and `nixpacks.toml` files:
- ✅ Explicitly define the build process
- ✅ Force Railway to use the server/ directory
- ✅ Override any auto-detection that might be wrong
- ✅ Ensure consistent deployments

## Summary

1. ✅ Created `server/railway.toml` and `server/nixpacks.toml`
2. Commit and push these files
3. Update Railway Root Directory to `server`
4. Add environment variables (especially `SUPABASE_SERVICE_ROLE_KEY`)
5. Redeploy
6. Test: Should return JSON, not HTML

Your backend should now work correctly!
