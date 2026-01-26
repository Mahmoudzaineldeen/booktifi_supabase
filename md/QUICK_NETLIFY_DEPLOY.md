# Quick Netlify Deployment - 5 Steps

## 🚀 Quick Start

### Step 1: Sign Up / Login
- Go to [netlify.com](https://www.netlify.com)
- Sign up with GitHub (recommended)

### Step 2: Import Project
1. Click **"Add new site"** → **"Import an existing project"**
2. Choose **"Deploy with GitHub"**
3. Select repository: `Mahmoudzaineldeen/booktifi_supabase`

### Step 3: Build Settings (Auto-detected)
- ✅ Build command: `npm run build`
- ✅ Publish directory: `dist`
- ✅ Base directory: (empty)

### Step 4: Environment Variables (CRITICAL!)
Click **"Show advanced"** → **"New variable"** and add:

```
VITE_API_URL = https://booktifisupabase-production.up.railway.app/api
```

```
VITE_SUPABASE_URL = https://pivmdulophbdciygvegx.supabase.co
```

```
VITE_SUPABASE_ANON_KEY = <your-anon-key-from-supabase>
```

### Step 5: Deploy
- Click **"Deploy site"**
- Wait 2-5 minutes
- Get your URL: `https://your-site.netlify.app`

---

## ✅ Verify

1. Open the Netlify URL
2. Open DevTools (F12) → Console
3. Try to sign in
4. Check Network tab → Should see Railway API calls

---

## 🔍 What to Check

- ✅ Site loads
- ✅ Sign in works
- ✅ No 401/400 errors
- ✅ API calls go to Railway (not localhost)
- ✅ Console has no errors

---

## 📝 Full Guide

See `NETLIFY_DEPLOYMENT_GUIDE.md` for detailed instructions.
