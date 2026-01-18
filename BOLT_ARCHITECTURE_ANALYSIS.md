# Bolt Architecture Analysis & Solution Plan

## Executive Summary

**Current State:** The project has a mixed architecture that works locally but fails in Bolt because:
1. Bolt does NOT run backend servers
2. All `/api/*` routes return 404 in Bolt
3. Authentication breaks because JWT verification requires backend
4. Critical services (PDF, Email, WhatsApp, Zoho) require backend

**Root Cause:** The architecture assumes a backend server is always available, which is false in Bolt.

## Error Mapping: Root Causes

### 404 Errors → Missing Backend Routes

**Affected Routes:**
- `/api/tenants/smtp-settings` (GET, PUT)
- `/api/tenants/whatsapp-settings` (GET, PUT)
- `/api/tenants/zoho-config` (GET, PUT)
- `/api/tenants/zoho-status` (GET)
- `/api/bookings/create` (POST)
- `/api/bookings/lock` (POST)
- `/api/customers/bookings` (GET)
- `/api/auth/*` (multiple endpoints)
- `/api/reviews/*` (POST, DELETE)
- `/api/query` (POST) - **Critical: All database queries**

**Why 404:**
- Bolt doesn't run Express server
- `/api/*` routes don't exist
- Vite proxy can't route to non-existent backend

### 401 Errors → Missing Authentication Context

**Affected Endpoints:**
- All `/api/tenants/*` routes (require `authenticateTenantAdmin`)
- `/api/customers/*` routes (require `authenticate`)
- Protected review operations

**Why 401:**
1. **JWT Verification Requires Backend:**
   - Frontend stores JWT in `localStorage`
   - Backend middleware `jwt.verify(token, JWT_SECRET)` doesn't run
   - No backend = no JWT verification = 401

2. **Token Context Lost:**
   - Even if token is sent, backend isn't there to verify it
   - `req.user` is never set
   - `tenant_id` is never extracted from token

3. **Authentication Flow Broken:**
   - `/api/auth/signin` → 404 (backend doesn't exist)
   - `/api/auth/signup` → 404
   - Token refresh → 404

### 400 Errors → Invalid Supabase Queries

**Current Status:** ✅ **FIXED** (POST queries, proper filter conversion)

**Previous Issues:**
- `column bookings.created_at__gte does not exist`
- Invalid PostgREST filter syntax
- URL encoding issues with GET requests

**Current Solution:**
- All queries use POST
- Backend converts `__gte`, `__lte`, etc. correctly
- **BUT:** Backend doesn't exist in Bolt, so queries still fail

## Architecture Analysis

### Current Data Flow

```
┌─────────────┐
│  Frontend   │
│  (Bolt)     │
└──────┬──────┘
       │
       ├─→ /api/query (POST) ──→ ❌ 404 (no backend)
       ├─→ /api/tenants/* ──→ ❌ 404 (no backend)
       ├─→ /api/bookings/* ──→ ❌ 404 (no backend)
       └─→ db.from() ──→ /api/query ──→ ❌ 404 (no backend)
```

### What Requires Backend (Cannot Run in Bolt)

#### 1. **PDF Generation** (Critical)
- **Location:** `server/src/services/pdfService.ts`
- **Dependencies:** `pdfkit`, `canvas`, Node.js Buffer operations
- **Used By:** Booking ticket generation
- **Bolt Status:** ❌ Cannot run (requires Node.js server)

#### 2. **Email Sending** (Critical)
- **Location:** `server/src/services/emailService.ts`
- **Dependencies:** `nodemailer`, SMTP connections
- **Used By:** Ticket delivery, invoice delivery
- **Bolt Status:** ❌ Cannot run (requires SMTP server access)

#### 3. **WhatsApp Sending** (Critical)
- **Location:** `server/src/services/whatsappService.ts`
- **Dependencies:** External API calls (Meta, Twilio, Wati)
- **Used By:** Ticket delivery, notifications
- **Bolt Status:** ❌ Cannot run (requires backend API keys)

#### 4. **Zoho Integration** (Critical)
- **Location:** `server/src/services/zohoService.ts`
- **Dependencies:** Zoho API, OAuth token management
- **Used By:** Invoice generation, OAuth flow
- **Bolt Status:** ❌ Cannot run (requires backend for OAuth callback)

#### 5. **JWT Authentication** (Critical)
- **Location:** `server/src/routes/*` (all middleware)
- **Dependencies:** `jsonwebtoken`, `JWT_SECRET`
- **Used By:** All protected routes
- **Bolt Status:** ❌ Cannot verify tokens (no backend)

#### 6. **Booking Locks** (Important)
- **Location:** `server/src/routes/bookings.ts`
- **Dependencies:** Database RPC function `acquire_booking_lock`
- **Used By:** Prevent double-booking during checkout
- **Bolt Status:** ⚠️ Could work via Supabase RPC directly

#### 7. **Password Hashing** (Critical)
- **Location:** `server/src/routes/auth.ts`
- **Dependencies:** `bcryptjs`
- **Used By:** Signup, password reset
- **Bolt Status:** ❌ Cannot hash passwords (security risk if done client-side)

### What Can Work via Supabase Directly

#### ✅ **Basic CRUD Operations**
- Reading tenants, services, bookings, users
- Filtering, sorting, pagination
- **Current Status:** Uses `/api/query` → ❌ Fails in Bolt

#### ✅ **Simple Queries**
- `db.from('table').select().eq().gte().lte()`
- **Current Status:** Goes through `/api/query` → ❌ Fails in Bolt

#### ✅ **Supabase Auth** (Alternative)
- `supabase.auth.signInWithPassword()`
- `supabase.auth.signUp()`
- **Current Status:** Not used (uses backend `/api/auth/*`)

## Solution Options

### Option 1: Frontend → Supabase Only (Bolt-Safe) ⚠️ LIMITED

**Approach:** Remove all backend dependencies, use Supabase directly

**Pros:**
- ✅ Works in Bolt immediately
- ✅ No backend deployment needed
- ✅ Simpler architecture

**Cons:**
- ❌ **Cannot generate PDFs** (no Node.js in browser)
- ❌ **Cannot send emails** (no SMTP access)
- ❌ **Cannot send WhatsApp** (API keys can't be in frontend)
- ❌ **Cannot create Zoho invoices** (OAuth requires backend callback)
- ❌ **Limited security** (RLS policies must handle all access control)
- ❌ **No password hashing** (must use Supabase Auth exclusively)

**Viability:** ❌ **NOT VIABLE** - Critical features require backend

### Option 2: Frontend → Publicly Deployed Backend ✅ RECOMMENDED

**Approach:** Deploy backend separately (Railway, Render, Fly.io, etc.), frontend calls it

**Architecture:**
```
┌─────────────┐
│  Frontend   │
│  (Bolt)     │
└──────┬──────┘
       │
       ├─→ https://api.yourdomain.com/api/query
       ├─→ https://api.yourdomain.com/api/tenants/*
       ├─→ https://api.yourdomain.com/api/bookings/*
       └─→ Supabase (direct) for simple queries
```

**Pros:**
- ✅ All features work (PDF, Email, WhatsApp, Zoho)
- ✅ Proper authentication (JWT verification)
- ✅ Secure (API keys in backend, not frontend)
- ✅ Works in Bolt (backend is external)
- ✅ Works locally (can still use localhost)

**Cons:**
- ⚠️ Requires backend deployment
- ⚠️ Additional infrastructure cost
- ⚠️ Need to manage CORS

**Implementation:**
1. Deploy backend to Railway/Render/Fly.io
2. Set `VITE_API_URL=https://api.yourdomain.com/api` in Bolt
3. Update frontend to use deployed backend URL
4. Configure CORS on backend

**Viability:** ✅ **VIABLE** - Best option for full functionality

### Option 3: Supabase Edge Functions / RPCs ⚠️ PARTIAL

**Approach:** Move backend logic to Supabase Edge Functions

**Pros:**
- ✅ Works in Bolt (Supabase handles execution)
- ✅ No separate backend deployment
- ✅ Serverless scaling

**Cons:**
- ❌ **PDF generation limited** (Deno environment, limited libraries)
- ❌ **Email/WhatsApp/Zoho** (can work, but complex)
- ❌ **Requires rewriting** existing Node.js code to Deno
- ❌ **Cold starts** may affect performance
- ❌ **Limited file system access**

**Viability:** ⚠️ **PARTIALLY VIABLE** - Requires significant refactoring

## Recommended Solution: Hybrid Approach

### Architecture

```
┌─────────────────────────────────────┐
│         Frontend (Bolt)              │
└──────┬──────────────────────────────┘
       │
       ├─→ Supabase (Direct) ──→ ✅ Simple queries, auth
       │   - db.from().select().eq()
       │   - Supabase Auth for login
       │
       └─→ Deployed Backend ──→ ✅ Complex operations
           - PDF generation
           - Email/WhatsApp
           - Zoho integration
           - JWT verification
           - Password hashing
```

### Implementation Plan

#### Phase 1: Enable Direct Supabase for Simple Operations ✅

**Changes:**
1. **Create Supabase client in frontend** (for read-only operations)
2. **Use Supabase Auth** for authentication
3. **Keep backend for complex operations**

**Files to Modify:**
- `src/lib/db.ts` - Add Supabase fallback for simple queries
- `src/contexts/AuthContext.tsx` - Use Supabase Auth
- `src/pages/*` - Use direct Supabase for reads

#### Phase 2: Deploy Backend Externally ✅

**Steps:**
1. Deploy backend to Railway/Render/Fly.io
2. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `APP_URL=https://bookati-2jy1.bolt.host`
3. Configure CORS to allow Bolt domain
4. Update frontend `VITE_API_URL` to deployed backend

#### Phase 3: Route Selection Logic ✅

**Smart routing:**
- **Simple queries** → Supabase direct (faster, no backend needed)
- **Complex operations** → Deployed backend (PDF, Email, etc.)

**Example:**
```typescript
// Simple query - use Supabase directly
const { data } = await supabase
  .from('bookings')
  .select('*')
  .eq('tenant_id', id);

// Complex operation - use backend
const response = await fetch(`${BACKEND_URL}/api/bookings/create`, {
  method: 'POST',
  body: JSON.stringify(bookingData)
});
```

## Detailed Error Analysis

### Error: `GET http://localhost:3001/api/tenants/smtp-settings → 401`

**Root Cause:**
1. Request goes to `localhost:3001` (doesn't exist in Bolt)
2. Even if routed, backend doesn't exist to verify JWT
3. `authenticateTenantAdmin` middleware never runs

**Why Current Fix Fails:**
- `getApiUrl()` returns `/api` in Bolt
- Vite proxy tries to route `/api/*` → no backend server
- Result: 404 or connection refused

**Solution:**
- Deploy backend externally
- Use deployed URL: `https://api.yourdomain.com/api/tenants/smtp-settings`
- Backend verifies JWT and returns data

### Error: `GET http://localhost:3001/api/tenants/smtp-settings → 404`

**Root Cause:**
- Backend server doesn't exist in Bolt
- `/api/*` routes are not available

**Solution:**
- Deploy backend to external service
- Update `VITE_API_URL` to deployed backend URL

### Error: `Supabase REST 400 - column does not exist`

**Root Cause:** ✅ **FIXED** (POST queries, proper filter conversion)

**Remaining Issue:**
- Queries go through `/api/query` → backend doesn't exist → 404
- Need to use Supabase directly OR deploy backend

## Migration Path

### Step 1: Immediate Fix (Enable Supabase Direct)

**For Simple Queries:**
```typescript
// Instead of:
const { data } = await db.from('bookings').select('*').eq('tenant_id', id);

// Use:
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const { data } = await supabase.from('bookings').select('*').eq('tenant_id', id);
```

**For Authentication:**
```typescript
// Use Supabase Auth instead of backend
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});
```

### Step 2: Deploy Backend

**Recommended Platforms:**
1. **Railway** (easiest)
2. **Render** (free tier available)
3. **Fly.io** (good performance)
4. **Heroku** (if budget allows)

**Deployment Steps:**
1. Create account on chosen platform
2. Connect GitHub repository
3. Set root directory to `server/`
4. Configure environment variables
5. Deploy
6. Get deployed URL (e.g., `https://bookati-api.railway.app`)

### Step 3: Update Frontend Configuration

**In Bolt Environment Variables:**
```env
VITE_API_URL=https://bookati-api.railway.app/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Update `getApiUrl()`:**
```typescript
const getApiUrl = () => {
  // In Bolt, use deployed backend
  if (window.location.hostname.includes('bolt.host')) {
    return import.meta.env.VITE_API_URL || 'https://bookati-api.railway.app/api';
  }
  // Local development
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};
```

### Step 4: Hybrid Query Strategy

**Create smart query router:**
```typescript
// Simple queries → Supabase direct
async function querySimple(table: string, filters: any) {
  return await supabase.from(table).select('*').eq(...);
}

// Complex queries → Backend
async function queryComplex(endpoint: string, body: any) {
  return await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}
```

## Critical Backend Routes Analysis

### Routes That MUST Have Backend

| Route | Why Backend Required | Alternative |
|-------|---------------------|-------------|
| `/api/bookings/create` | PDF generation, Email/WhatsApp sending | ❌ None |
| `/api/tenants/smtp-settings/test` | SMTP connection testing (nodemailer) | ❌ None |
| `/api/tenants/whatsapp-settings/test` | WhatsApp API testing | ❌ None |
| `/api/zoho/*` | OAuth callback, invoice generation | ❌ None |
| `/api/auth/signup` | Password hashing (bcrypt) | ✅ Supabase Auth |
| `/api/auth/signin` | JWT generation | ✅ Supabase Auth |
| `/api/auth/forgot-password` | OTP generation, email sending | ⚠️ Partial (Supabase Auth + backend for email) |

### Routes That Can Use Supabase Direct

| Route | Current | Can Use Supabase? |
|-------|---------|-------------------|
| `/api/query` | Backend proxy | ✅ Yes (direct Supabase) |
| `/api/tenants/smtp-settings` (GET) | Backend with auth | ⚠️ Yes (with RLS) |
| `/api/tenants/whatsapp-settings` (GET) | Backend with auth | ⚠️ Yes (with RLS) |
| `/api/customers/bookings` | Backend with auth | ✅ Yes (RLS by customer_id) |
| `/api/reviews` (GET) | Backend | ✅ Yes (public or RLS) |

## Recommended Implementation

### Architecture Decision: **Option 2 - Deployed Backend**

**Why:**
1. ✅ Preserves all functionality
2. ✅ Minimal code changes
3. ✅ Works in Bolt and locally
4. ✅ Secure (API keys in backend)

### Implementation Steps

1. **Deploy Backend** (Railway/Render)
2. **Update Frontend** to use deployed URL in Bolt
3. **Keep Local Development** using localhost
4. **Hybrid Queries** - Use Supabase direct for simple reads, backend for complex operations

### Code Changes Required

**Minimal Changes:**
- Update `getApiUrl()` to use deployed backend in Bolt
- Keep existing backend routes (no changes needed)
- Deploy backend to external service

**Optional Optimizations:**
- Use Supabase direct for simple queries (faster)
- Keep backend for complex operations

## Conclusion

**Current Problem:** Architecture assumes backend is always available, which fails in Bolt.

**Solution:** Deploy backend externally and update frontend to use deployed URL in Bolt.

**Viability:** ✅ **FULLY VIABLE** - All features preserved, minimal changes required.
