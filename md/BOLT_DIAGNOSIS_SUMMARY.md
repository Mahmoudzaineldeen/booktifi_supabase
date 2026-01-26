# Bolt Architecture Diagnosis - Complete Summary

## Executive Summary

**Root Cause:** The project architecture assumes a backend server is always available at `localhost:3001`, which **does not exist in Bolt**. Bolt only runs the frontend; no Node.js/Express server is executed.

**Impact:** All `/api/*` routes return 404, causing:
- ❌ 404 errors (backend routes don't exist)
- ❌ 401 errors (JWT verification requires backend)
- ❌ 400 errors (database queries go through non-existent backend)
- ❌ Complete feature breakdown (PDF, Email, WhatsApp, Zoho all fail)

**Solution:** Deploy backend externally (Railway/Render/Fly.io) and update frontend to use deployed URL in Bolt.

## Error Mapping: Root Causes

### 404 Errors → Missing Backend Routes

**Affected Routes:**
```
GET  /api/tenants/smtp-settings          → 404
PUT  /api/tenants/smtp-settings            → 404
POST /api/tenants/smtp-settings/test      → 404
GET  /api/tenants/whatsapp-settings        → 404
PUT  /api/tenants/whatsapp-settings        → 404
POST /api/tenants/whatsapp-settings/test   → 404
GET  /api/tenants/zoho-config              → 404
PUT  /api/tenants/zoho-config              → 404
GET  /api/tenants/zoho-status              → 404
POST /api/bookings/create                  → 404
POST /api/bookings/lock                    → 404
GET  /api/customers/bookings               → 404
POST /api/query                            → 404 (ALL database queries)
GET  /api/auth/*                           → 404
POST /api/auth/*                           → 404
```

**Why 404:**
1. Vite proxy routes `/api/*` → `http://localhost:3001`
2. No backend server exists in Bolt
3. Connection refused / 404 Not Found

**Architectural Reason:**
- Bolt is a frontend-only environment
- No Node.js runtime for Express server
- `server/src/index.ts` never executes
- All routes defined in `server/src/routes/*` are unreachable

### 401 Errors → Missing Authentication Context

**Affected Endpoints:**
- All `/api/tenants/*` routes (require `authenticateTenantAdmin`)
- `/api/customers/*` routes (require `authenticate`)
- Protected review operations

**Why 401:**
1. **JWT Verification Requires Backend:**
   ```typescript
   // server/src/routes/tenants.ts
   function authenticateTenantAdmin(req, res, next) {
     const decoded = jwt.verify(token, JWT_SECRET); // ❌ Backend doesn't exist
   }
   ```
   - Frontend stores JWT in `localStorage`
   - Backend middleware never runs
   - No backend = no JWT verification = 401

2. **Token Context Lost:**
   - Even if token is sent, backend isn't there to verify
   - `req.user` is never set
   - `tenant_id` is never extracted from token

3. **Authentication Flow Broken:**
   - `/api/auth/signin` → 404 (backend doesn't exist)
   - `/api/auth/signup` → 404
   - Token refresh → 404

**Architectural Reason:**
- Authentication middleware (`authenticateTenantAdmin`, `authenticate`) runs in backend
- JWT verification requires `JWT_SECRET` (should not be in frontend)
- Backend extracts `tenant_id` from token for RLS/authorization

### 400 Errors → Invalid Supabase Queries

**Status:** ✅ **FIXED** (POST queries, proper filter conversion)

**Previous Issues:**
- `column bookings.created_at__gte does not exist`
- Invalid PostgREST filter syntax
- URL encoding issues with GET requests

**Current Status:**
- ✅ Frontend sends POST requests with JSON body
- ✅ Backend converts `__gte`, `__lte`, etc. correctly
- ❌ **BUT:** Backend doesn't exist in Bolt, so queries still fail with 404

**Remaining Issue:**
- Queries go through `/api/query` → backend doesn't exist → 404
- Need deployed backend OR use Supabase directly

## What Requires Backend (Cannot Run in Bolt)

### 1. PDF Generation ❌
- **Location:** `server/src/services/pdfService.ts`
- **Dependencies:** `pdfkit`, `canvas`, Node.js Buffer
- **Used By:** Booking ticket generation
- **Bolt Status:** ❌ Cannot run (requires Node.js server)

### 2. Email Sending ❌
- **Location:** `server/src/services/emailService.ts`
- **Dependencies:** `nodemailer`, SMTP connections
- **Used By:** Ticket delivery, invoice delivery
- **Bolt Status:** ❌ Cannot run (requires SMTP server access)

### 3. WhatsApp Sending ❌
- **Location:** `server/src/services/whatsappService.ts`
- **Dependencies:** External API calls (Meta, Twilio, Wati)
- **Used By:** Ticket delivery, notifications
- **Bolt Status:** ❌ Cannot run (requires backend API keys)

### 4. Zoho Integration ❌
- **Location:** `server/src/services/zohoService.ts`
- **Dependencies:** Zoho API, OAuth token management
- **Used By:** Invoice generation, OAuth flow
- **Bolt Status:** ❌ Cannot run (requires backend for OAuth callback)

### 5. JWT Authentication ❌
- **Location:** `server/src/routes/*` (all middleware)
- **Dependencies:** `jsonwebtoken`, `JWT_SECRET`
- **Used By:** All protected routes
- **Bolt Status:** ❌ Cannot verify tokens (no backend)

### 6. Password Hashing ❌
- **Location:** `server/src/routes/auth.ts`
- **Dependencies:** `bcryptjs`
- **Used By:** Signup, password reset
- **Bolt Status:** ❌ Cannot hash passwords (security risk if done client-side)

### 7. Booking Locks ⚠️
- **Location:** `server/src/routes/bookings.ts`
- **Dependencies:** Database RPC function `acquire_booking_lock`
- **Used By:** Prevent double-booking during checkout
- **Bolt Status:** ⚠️ Could work via Supabase RPC directly (but currently goes through backend)

## What Can Work via Supabase Directly

### ✅ Basic CRUD Operations
- Reading tenants, services, bookings, users
- Filtering, sorting, pagination
- **Current Status:** Uses `/api/query` → ❌ Fails in Bolt

### ✅ Simple Queries
- `db.from('table').select().eq().gte().lte()`
- **Current Status:** Goes through `/api/query` → ❌ Fails in Bolt

### ✅ Supabase Auth (Alternative)
- `supabase.auth.signInWithPassword()`
- `supabase.auth.signUp()`
- **Current Status:** Not used (uses backend `/api/auth/*`)

## Recommended Solution

### Architecture: Deployed Backend + Frontend

```
┌─────────────────────────────────────┐
│      Frontend (Bolt)                 │
│      https://bookati-2jy1.bolt.host  │
└──────┬───────────────────────────────┘
       │
       └─→ Deployed Backend ──→ ✅ All operations
           https://api.yourdomain.com
           - PDF generation
           - Email/WhatsApp
           - Zoho integration
           - JWT verification
           - Database queries
```

### Implementation Steps

1. **Deploy Backend** (Railway/Render/Fly.io)
   - Root directory: `server/`
   - Start command: `npm run dev` or `npm start`
   - Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `APP_URL`

2. **Update Frontend Configuration**
   - Set `VITE_API_URL=https://your-backend.railway.app/api` in Bolt
   - Update `getApiUrl()` to use deployed URL in Bolt

3. **Test**
   - Verify backend is accessible
   - Test all API endpoints
   - Confirm no 404/401 errors

### Code Changes Required

**Minimal Changes:**
- Update `src/lib/db.ts` - `getApiUrl()` function
- Update `src/pages/tenant/SettingsPage.tsx` - `getApiUrl()` function
- Set `VITE_API_URL` in Bolt environment variables

**No Architecture Changes Needed:**
- ✅ Keep existing backend routes
- ✅ Keep existing authentication
- ✅ Keep existing services (PDF, Email, etc.)

## Why Current Setup Will Always Fail in Bolt

1. **Backend Server Never Runs:**
   - Bolt only executes frontend code
   - `server/src/index.ts` never executes
   - Express routes are never registered

2. **Vite Proxy Points to Non-Existent Server:**
   ```typescript
   // vite.config.ts
   proxy: {
     '/api': {
       target: 'http://localhost:3001', // ❌ Doesn't exist
     }
   }
   ```

3. **All Operations Assume Backend:**
   - Database queries → `/api/query` → ❌ 404
   - Authentication → `/api/auth/*` → ❌ 404
   - Complex operations → `/api/*` → ❌ 404

## What Must Change Architecturally

### Required Changes

1. **Deploy Backend Externally:**
   - Railway, Render, or Fly.io
   - Backend must be accessible via HTTPS URL
   - Environment variables configured

2. **Update Frontend API URLs:**
   - In Bolt: Use deployed backend URL
   - In local dev: Use `localhost:3001`
   - Smart detection based on hostname

3. **Configure CORS:**
   - Backend must allow Bolt domain
   - Already configured: `origin: true` (allows all)

### Optional Optimizations

1. **Hybrid Queries:**
   - Simple reads → Supabase direct (faster)
   - Complex operations → Backend (required)

2. **Supabase Auth:**
   - Migrate to Supabase Auth (simpler)
   - Or keep backend auth (requires deployed backend)

## Conclusion

**Root Cause:** Architecture assumes backend is always available → fails in Bolt.

**Solution:** Deploy backend externally → update frontend to use deployed URL.

**Viability:** ✅ **FULLY VIABLE** - All features preserved, minimal code changes.

**Next Step:** Deploy backend to Railway/Render and set `VITE_API_URL` in Bolt.
