# Environment Variables and GitHub

## Why `.env` Files Are Not in GitHub

**`.env` files contain secrets** (API keys, passwords, tokens) and should **NEVER** be committed to GitHub for security reasons.

## What's in GitHub

✅ **`.env.example`** - Template file with placeholder values (safe to commit)  
❌ **`.env`** - Your actual secrets (should NOT be in GitHub)

## Current Setup

### `.gitignore` Configuration

The project's `.gitignore` file has:
```gitignore
# Ignore root .env but allow server/.env
/.env
!server/.env
```

This means:
- Root `.env` is ignored ✅
- `server/.env` is **NOT ignored** (can be committed) ⚠️

## Recommendation

**For security, you should:**

1. **Add `server/.env` to `.gitignore`:**
   ```gitignore
   # Ignore all .env files
   .env
   server/.env
   ```

2. **Use `.env.example` as a template:**
   - `.env.example` is now in GitHub with all variable names
   - Copy it to `.env` locally
   - Fill in your actual values
   - Never commit `.env`

## For Railway Deployment

**Environment variables should be set in Railway Dashboard**, not in `.env` files:

1. Go to Railway Dashboard → Your Service → **Variables**
2. Add each variable manually:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `NODE_ENV=production`
   - `APP_URL`
   - `SENDGRID_API_KEY` (optional)

## How to Update Environment Variables

### Local Development:
1. Edit `server/.env` file locally
2. Add/update your values
3. Restart the server

### Railway Production:
1. Go to Railway Dashboard
2. Navigate to your service
3. Click **Variables** tab
4. Add or edit variables
5. Railway will automatically redeploy

### Bolt Frontend:
1. Go to Bolt Dashboard
2. Navigate to your project
3. Click **Environment Variables**
4. Add/update `VITE_*` variables

## Required Variables Checklist

### Backend (Railway):
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `JWT_SECRET`
- [ ] `NODE_ENV=production`
- [ ] `APP_URL`
- [ ] `SENDGRID_API_KEY` (optional, recommended)

### Frontend (Bolt):
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `VITE_API_URL`
- [ ] `VITE_QR_SECRET` (optional)

## Security Best Practices

1. ✅ **Never commit `.env` files to GitHub**
2. ✅ **Use `.env.example` as a template**
3. ✅ **Set secrets in deployment platforms** (Railway, Bolt)
4. ✅ **Rotate secrets regularly**
5. ✅ **Use different secrets for dev/staging/production**

---

**Summary:** `.env` files are intentionally not in GitHub for security. Use `.env.example` as a reference, and set actual values in Railway/Bolt dashboards.
