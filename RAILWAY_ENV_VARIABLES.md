# Railway Environment Variables - Complete Guide

## Required Variables (Must Have)

These are **essential** for the backend to work:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=your-secret-key-change-in-production
```

### How to Get These Values:

1. **SUPABASE_URL:**
   - Go to: Supabase Dashboard → Settings → API
   - Copy the "Project URL"
   - Example: `https://abcdefghijklmnop.supabase.co`

2. **SUPABASE_SERVICE_ROLE_KEY:**
   - Go to: Supabase Dashboard → Settings → API
   - Copy the "service_role" key (⚠️ Keep this secret!)
   - This is different from the "anon" key
   - Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

3. **JWT_SECRET:**
   - This is a secret key you create yourself
   - Use a long, random string (at least 32 characters)
   - **Important:** Use the same value in Bolt frontend environment variables
   - Example: `my-super-secret-jwt-key-1234567890abcdef`

## Recommended Variables (Should Have)

These improve functionality and security:

```env
NODE_ENV=production
PORT=3001
APP_URL=https://bookati-2jy1.bolt.host
```

### Explanation:

1. **NODE_ENV=production:**
   - Enables production optimizations
   - Hides error stack traces from API responses
   - Improves security

2. **PORT=3001:**
   - Port for the backend server
   - Railway auto-assigns, but you can set it explicitly
   - Railway will override with their own port in production

3. **APP_URL:**
   - Your Bolt frontend URL
   - Used for Zoho OAuth redirects
   - Example: `https://bookati-2jy1.bolt.host`

## Optional Variables (Nice to Have)

These are optional and have defaults:

### Zoho Integration (Optional - Can be configured per-tenant in database)

```env
ZOHO_CLIENT_ID=your-zoho-client-id
ZOHO_CLIENT_SECRET=your-zoho-client-secret
ZOHO_REDIRECT_URI=https://bookati-2jy1.bolt.host/api/zoho/callback
ZOHO_REGION=com
ZOHO_SCOPE=ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE
ZOHO_API_BASE_URL=https://invoice.zoho.com/api/v3
ZOHO_WORKER_INTERVAL=30000
```

**Note:** Zoho credentials can also be configured per-tenant in the database (Settings → Integrations). Global env vars are used as fallback.

### Explanation:

1. **ZOHO_CLIENT_ID & ZOHO_CLIENT_SECRET:**
   - From Zoho Developer Console
   - Only needed if you want global Zoho credentials
   - Per-tenant credentials in database take priority

2. **ZOHO_REDIRECT_URI:**
   - OAuth callback URL
   - Defaults to: `{APP_URL}/api/zoho/callback`
   - Must match what's configured in Zoho Developer Console

3. **ZOHO_REGION:**
   - Zoho organization region
   - Options: `com`, `eu`, `in`, `au`, `ca`, `uk`
   - Default: `com`

4. **ZOHO_SCOPE:**
   - OAuth scopes for Zoho API
   - Default: `ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE`

5. **ZOHO_API_BASE_URL:**
   - Base URL for Zoho Invoice API
   - Default: `https://invoice.zoho.com/api/v3`
   - Change based on region (e.g., `https://invoice.zoho.eu/api/v3` for EU)

6. **ZOHO_WORKER_INTERVAL:**
   - Interval for Zoho receipt worker (milliseconds)
   - Default: `30000` (30 seconds)

## Complete Railway Environment Variables Setup

### Minimum Setup (Required Only)

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=your-secret-key-change-in-production
```

### Recommended Setup (Production Ready)

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
PORT=3001
APP_URL=https://bookati-2jy1.bolt.host
```

### Full Setup (With Zoho)

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
PORT=3001
APP_URL=https://bookati-2jy1.bolt.host
ZOHO_CLIENT_ID=your-zoho-client-id
ZOHO_CLIENT_SECRET=your-zoho-client-secret
ZOHO_REDIRECT_URI=https://bookati-2jy1.bolt.host/api/zoho/callback
ZOHO_REGION=com
```

## How to Add Variables in Railway

1. **Go to Railway Dashboard:**
   - Open your project
   - Click on your backend service

2. **Open Variables Tab:**
   - Click "Variables" in the left sidebar
   - Or click "New" → "Variable"

3. **Add Each Variable:**
   - Click "New Variable"
   - Enter variable name (e.g., `SUPABASE_URL`)
   - Enter variable value
   - Click "Add"

4. **Repeat for All Variables:**
   - Add all required variables
   - Railway will automatically redeploy when you save

## Important Notes

### Security:
- ⚠️ **Never commit** `.env` files to Git
- ⚠️ **Never share** `SUPABASE_SERVICE_ROLE_KEY` publicly
- ⚠️ **Never share** `JWT_SECRET` publicly
- ✅ Railway encrypts environment variables at rest

### JWT_SECRET Consistency:
- **Must match** the `JWT_SECRET` in your Bolt frontend environment variables
- If they don't match, authentication will fail (401 errors)
- Use the same value in both places

### Supabase Keys:
- **SUPABASE_SERVICE_ROLE_KEY** (backend) - Bypasses RLS, full access
- **VITE_SUPABASE_ANON_KEY** (frontend) - Subject to RLS, public
- **Never use** service role key in frontend!

### Port Configuration:
- Railway automatically assigns a port
- Your app should use `process.env.PORT` (already configured)
- Railway exposes it via their own URL

## Verification

After adding variables, check Railway logs:

1. **Check Backend Started:**
   ```
   🚀 API Server running on http://localhost:3001
   📊 Database: your-project-id
   ✅ Supabase client initialized
   ```

2. **Check Database Connection:**
   ```
   ✅ Database connection successful
   ```

3. **Check Zoho (if configured):**
   ```
   ✅ Zoho global credentials available (fallback)
   ```
   OR
   ```
   ℹ️  Zoho credentials: Will be loaded from database per tenant
   ```

## Troubleshooting

### "Missing Supabase configuration"
- ✅ Check `SUPABASE_URL` is set
- ✅ Check `SUPABASE_SERVICE_ROLE_KEY` is set
- ✅ Verify no typos in variable names

### "Using ANON key instead of SERVICE_ROLE key"
- ⚠️ You're using `VITE_SUPABASE_ANON_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY`
- ✅ Add `SUPABASE_SERVICE_ROLE_KEY` to Railway variables
- ✅ Remove `VITE_SUPABASE_ANON_KEY` (or keep it, but service role takes priority)

### Authentication fails (401 errors)
- ✅ Check `JWT_SECRET` matches between Railway and Bolt
- ✅ Verify token is being sent in `Authorization: Bearer <token>` header
- ✅ Check Railway logs for JWT verification errors

### Zoho OAuth fails
- ✅ Check `APP_URL` is set correctly
- ✅ Verify `ZOHO_REDIRECT_URI` matches Zoho Developer Console
- ✅ Check `ZOHO_REGION` matches your Zoho organization

## Quick Reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SUPABASE_URL` | ✅ Yes | - | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | - | Supabase service role key (bypasses RLS) |
| `JWT_SECRET` | ✅ Yes | `your-secret-key-change-in-production` | JWT signing secret |
| `NODE_ENV` | ⚠️ Recommended | `development` | Environment mode |
| `PORT` | ⚠️ Recommended | `3001` | Server port |
| `APP_URL` | ⚠️ Recommended | `http://localhost:3001` | Frontend URL for OAuth |
| `ZOHO_CLIENT_ID` | ❌ Optional | - | Zoho OAuth client ID |
| `ZOHO_CLIENT_SECRET` | ❌ Optional | - | Zoho OAuth client secret |
| `ZOHO_REDIRECT_URI` | ❌ Optional | `{APP_URL}/api/zoho/callback` | Zoho OAuth redirect |
| `ZOHO_REGION` | ❌ Optional | `com` | Zoho organization region |
| `ZOHO_SCOPE` | ❌ Optional | `ZohoInvoice.invoices.*` | Zoho OAuth scopes |
| `ZOHO_API_BASE_URL` | ❌ Optional | `https://invoice.zoho.com/api/v3` | Zoho API base URL |
| `ZOHO_WORKER_INTERVAL` | ❌ Optional | `30000` | Zoho worker interval (ms) |
