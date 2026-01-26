# Netlify Deployment Guide - Step by Step

This guide will help you deploy your frontend to Netlify to test if issues are specific to Bolt or more general.

## Prerequisites

1. ✅ GitHub repository with your code (already done)
2. ✅ Netlify account (free tier is fine)
3. ✅ Railway backend deployed and running (already done)

---

## Step 1: Create Netlify Account

1. Go to [https://www.netlify.com](https://www.netlify.com)
2. Click **"Sign up"** (top right)
3. Choose **"Sign up with GitHub"** (recommended)
4. Authorize Netlify to access your GitHub account

---

## Step 2: Add New Site from Git

1. In Netlify dashboard, click **"Add new site"**
2. Select **"Import an existing project"**
3. Choose **"Deploy with GitHub"**
4. Authorize Netlify to access your repositories (if prompted)
5. Search for your repository: `Mahmoudzaineldeen/booktifi_supabase`
6. Click on your repository

---

## Step 3: Configure Build Settings

Netlify should auto-detect Vite, but verify these settings:

### Build Settings:
- **Base directory:** Leave empty (root directory)
- **Build command:** `npm run build`
- **Publish directory:** `dist`

**Note:** These should be auto-detected from `netlify.toml`, but verify they match.

---

## Step 4: Set Environment Variables

**CRITICAL:** You must set these environment variables in Netlify:

1. In the **"Environment variables"** section, click **"Add variable"**

2. Add these variables one by one:

   ```
   VITE_API_URL = https://booktifisupabase-production.up.railway.app/api
   ```

   ```
   VITE_SUPABASE_URL = https://pivmdulophbdciygvegx.supabase.co
   ```

   ```
   VITE_SUPABASE_ANON_KEY = <your-anon-key>
   ```
   
   **To get your anon key:**
   - Go to Supabase Dashboard
   - Settings → API
   - Copy the "anon public" key

3. Click **"Save"** after adding each variable

---

## Step 5: Deploy

1. Click **"Deploy site"** button
2. Wait for the build to complete (usually 2-5 minutes)
3. You'll see build logs in real-time
4. Once complete, you'll get a URL like: `https://random-name-123.netlify.app`

---

## Step 6: Verify Deployment

1. **Check Build Logs:**
   - Look for any errors in the build process
   - Should see: "Build finished successfully"

2. **Test the Site:**
   - Open the Netlify URL in your browser
   - Open DevTools (F12) → Console tab
   - Check for any errors

3. **Test API Connection:**
   - Try to sign in
   - Check Network tab → Should see requests to Railway backend
   - Verify no `localhost:3001` references

---

## Step 7: Custom Domain (Optional)

If you want a custom domain:

1. Go to **Site settings** → **Domain management**
2. Click **"Add custom domain"**
3. Enter your domain
4. Follow DNS configuration instructions

---

## Troubleshooting

### Build Fails

**Error: "Command failed"**
- Check build logs for specific error
- Verify Node version (should be 18+)
- Check that all dependencies are in `package.json`

**Error: "Module not found"**
- Run `npm install` locally to verify dependencies
- Check `package.json` has all required packages

### Site Works But API Calls Fail

**401 Unauthorized Errors:**
- Verify `VITE_API_URL` is set correctly in Netlify
- Check that Railway backend is running
- Verify JWT_SECRET matches between environments

**CORS Errors:**
- Railway backend should already allow all origins
- Check Railway logs for CORS errors

**404 Not Found:**
- Verify `VITE_API_URL` includes `/api` suffix
- Check Network tab to see actual request URL

### Environment Variables Not Working

**Variables not being used:**
- Netlify requires rebuild after adding variables
- Go to **Deploys** → **Trigger deploy** → **Clear cache and deploy site**
- Variables starting with `VITE_` are available in frontend code

---

## Testing Checklist

After deployment, test:

- [ ] Site loads without errors
- [ ] Sign in works
- [ ] API calls go to Railway (not localhost)
- [ ] No 401/400 errors
- [ ] Tenant settings load
- [ ] Bookings work
- [ ] No console errors

---

## Comparison: Netlify vs Bolt

### If it works on Netlify but not Bolt:
- ✅ Issue is specific to Bolt environment
- ✅ Code is correct
- ✅ Need to clear Bolt cache

### If it fails on both Netlify and Bolt:
- ❌ Issue is in the code
- ❌ Need to check environment variables
- ❌ Need to verify Railway backend

---

## Quick Reference

**Netlify Dashboard:** [https://app.netlify.com](https://app.netlify.com)

**Your Railway Backend:** `https://booktifisupabase-production.up.railway.app`

**Required Environment Variables:**
- `VITE_API_URL` = `https://booktifisupabase-production.up.railway.app/api`
- `VITE_SUPABASE_URL` = `https://pivmdulophbdciygvegx.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = (your anon key)

---

## Next Steps

After successful deployment:

1. Test all major features
2. Compare behavior with Bolt
3. Check Network tab for API calls
4. Verify no localhost references
5. Test authentication flow
6. Test tenant settings

If everything works on Netlify, the issue is likely Bolt-specific (cached build).

---

**Need Help?**
- Check Netlify build logs
- Check Railway backend logs
- Check browser console for errors
- Verify environment variables are set
