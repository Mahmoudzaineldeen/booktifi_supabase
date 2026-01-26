# Bolt Deployment Workflow

## How Bolt Deploys Your Changes

Bolt automatically watches your GitHub repository and redeploys when you push changes to the connected branch (usually `main`).

## Step-by-Step: Deploy Changes to Bolt

### 1. Commit Your Changes

First, stage and commit all changes:

```bash
# Stage all modified and new files
git add .

# Commit with descriptive message
git commit -m "Fix: Remove Supabase fallback - force all requests through backend API"
```

### 2. Push to GitHub

Push your commits to the remote repository:

```bash
git push origin main
```

**Note**: Replace `main` with your branch name if different (e.g., `master`, `develop`)

### 3. Bolt Auto-Deployment

Once you push to GitHub:
- ✅ Bolt automatically detects the new commit
- ✅ Pulls the latest code from GitHub
- ✅ Rebuilds and redeploys your application
- ✅ Usually takes 1-3 minutes

### 4. Verify Deployment

**In Bolt Dashboard:**
1. Go to your Bolt project dashboard
2. Check the "Deployments" or "Activity" tab
3. You should see a new deployment triggered by your push

**In Your Application:**
1. Wait 1-3 minutes after pushing
2. Refresh your Bolt deployment URL
3. Check browser console for any errors
4. Verify the changes are live

## Manual Deployment (If Auto-Deploy Fails)

If Bolt doesn't auto-deploy, you can trigger it manually:

### Option 1: In Bolt Dashboard
1. Go to your Bolt project
2. Look for "Redeploy" or "Deploy" button
3. Click to trigger a new deployment

### Option 2: Force Push (Triggers Redeploy)
```bash
# Make a small change and push again
git commit --allow-empty -m "Trigger Bolt redeploy"
git push origin main
```

## Current Status

**Uncommitted Changes:**
- `server/src/db.ts` - Enhanced with explicit apikey header
- `src/lib/db.ts` - Removed Supabase fallback logic
- `SUPABASE_ARCHITECTURE_FIX.md` - Documentation

**To Deploy These Changes:**
```bash
git add .
git commit -m "Fix: Remove Supabase fallback - ensure all requests go through backend with proper authentication"
git push origin main
```

## Troubleshooting

### Changes Not Appearing?

1. **Check if push was successful:**
   ```bash
   git log --oneline -1
   git status
   ```

2. **Verify Bolt is connected to correct repo:**
   - Bolt dashboard → Settings → Repository
   - Should match: `https://github.com/Mahmoudzaineldeen/booktifi_supabase.git`

3. **Check Bolt deployment logs:**
   - Bolt dashboard → Deployments → Latest deployment → Logs
   - Look for errors during build/deploy

4. **Force clear cache:**
   - In Bolt dashboard, try "Redeploy" or "Clear Cache"
   - Sometimes cached builds need to be cleared

### Environment Variables

**Important**: After deploying, ensure environment variables are set in Bolt:

1. Go to Bolt dashboard → Settings → Environment Variables
2. Verify these are set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (for backend)
   - `VITE_API_URL` (if needed)
   - `JWT_SECRET`

3. **After updating env vars**, trigger a redeploy

## Best Practices

1. **Always commit and push together:**
   ```bash
   git add .
   git commit -m "Descriptive message"
   git push origin main
   ```

2. **Use meaningful commit messages:**
   - Helps track what changed
   - Makes debugging easier

3. **Test locally before pushing:**
   - Run `npm run dev` locally
   - Verify changes work
   - Then push to deploy

4. **Monitor deployment logs:**
   - Check Bolt dashboard after each push
   - Watch for build errors
   - Fix issues before they affect users

## Quick Reference

```bash
# Full workflow
git add .
git commit -m "Your commit message"
git push origin main

# Check status
git status
git log --oneline -5

# Verify remote
git remote -v
```
