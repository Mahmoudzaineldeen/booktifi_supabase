# Bolt Architecture Solution - Implementation Plan

## Root Cause Diagnosis

### Why Current Setup Fails in Bolt

1. **Vite Proxy Assumes Backend Exists:**
   ```typescript
   // vite.config.ts
   proxy: {
     '/api': {
       target: 'http://localhost:3001', // ❌ Doesn't exist in Bolt
     }
   }
   ```
   - Frontend requests `/api/*` → Vite proxy → `localhost:3001` → ❌ Connection refused/404

2. **All Database Queries Go Through Backend:**
   ```typescript
   // src/lib/db.ts
   const result = await self.request('/query', { method: 'POST', ... });
   // → /api/query → ❌ 404 (no backend)
   ```

3. **Authentication Requires Backend:**
   ```typescript
   // server/src/routes/tenants.ts
   function authenticateTenantAdmin(req, res, next) {
     const decoded = jwt.verify(token, JWT_SECRET); // ❌ Backend doesn't exist
   }
   ```

4. **Critical Services Require Backend:**
   - PDF generation (Node.js only)
   - Email sending (SMTP)
   - WhatsApp (external APIs)
   - Zoho (OAuth + API)

## Solution: Hybrid Architecture

### Architecture Overview

```
┌─────────────────────────────────────────┐
│      Frontend (Bolt)                    │
│      https://bookati-2jy1.bolt.host     │
└──────┬──────────────────────────────────┘
       │
       ├─→ Supabase Direct ──→ ✅ Simple queries
       │   - Read operations
       │   - Supabase Auth
       │   - No backend needed
       │
       └─→ Deployed Backend ──→ ✅ Complex operations
           https://api.yourdomain.com
           - PDF generation
           - Email/WhatsApp
           - Zoho integration
           - JWT verification
```

## Implementation Plan

### Phase 1: Enable Supabase Direct for Simple Operations

**Goal:** Make read operations work in Bolt without backend

#### Step 1.1: Create Hybrid Database Client

**File: `src/lib/db-hybrid.ts`** (new file)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase client for direct operations (Bolt-safe)
const supabaseClient = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Backend URL (deployed or localhost)
const getBackendUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('bolt.host') || hostname.includes('webcontainer')) {
      // In Bolt, use deployed backend
      return import.meta.env.VITE_API_URL || 'https://api.yourdomain.com/api';
    }
  }
  // Local development
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};

const BACKEND_URL = getBackendUrl();

/**
 * Hybrid Database Client
 * - Simple queries → Supabase direct (fast, works in Bolt)
 * - Complex operations → Backend (PDF, Email, etc.)
 */
class HybridDatabaseClient {
  // Simple read operations → Supabase
  async querySimple(table: string, filters: any) {
    if (!supabaseClient) {
      throw new Error('Supabase client not configured');
    }
    
    let query = supabaseClient.from(table).select('*');
    
    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      if (key.endsWith('__gte')) {
        query = query.gte(key.replace('__gte', ''), value);
      } else if (key.endsWith('__lte')) {
        query = query.lte(key.replace('__lte', ''), value);
      } else if (key.endsWith('__in')) {
        query = query.in(key.replace('__in', ''), value as any[]);
      } else {
        query = query.eq(key, value);
      }
    });
    
    return await query;
  }
  
  // Complex operations → Backend
  async requestBackend(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      return { data: null, error };
    }
    
    const data = await response.json();
    return { data, error: null };
  }
}

export const hybridDb = new HybridDatabaseClient();
```

#### Step 1.2: Update Settings Page to Use Hybrid Approach

**File: `src/pages/tenant/SettingsPage.tsx`**

**For Simple Reads (SMTP/WhatsApp/Zoho GET):**
```typescript
// Instead of:
const response = await fetch(`${API_URL}/tenants/smtp-settings`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Use Supabase direct:
const { data: tenant } = await supabase
  .from('tenants')
  .select('smtp_settings, whatsapp_settings, zoho_config')
  .eq('id', tenantId)
  .single();

const smtpSettings = tenant?.smtp_settings || null;
```

**For Complex Operations (SMTP Test, Save):**
```typescript
// Still use backend (requires nodemailer, etc.)
const response = await fetch(`${BACKEND_URL}/tenants/smtp-settings/test`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(smtpSettings)
});
```

### Phase 2: Deploy Backend Externally

**Recommended Platform: Railway** (easiest setup)

#### Step 2.1: Prepare Backend for Deployment

**File: `server/railway.json`** (create)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run dev",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**File: `server/package.json`** - Ensure start script:
```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts"
  }
}
```

#### Step 2.2: Deploy to Railway

1. **Create Railway Account:** https://railway.app
2. **New Project** → Deploy from GitHub
3. **Select Repository:** Your GitHub repo
4. **Root Directory:** Set to `server/`
5. **Environment Variables:**
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   JWT_SECRET=your-secret-key-change-in-production
   APP_URL=https://bookati-2jy1.bolt.host
   PORT=3001
   NODE_ENV=production
   ```
6. **Deploy** → Get URL: `https://your-project.railway.app`

#### Step 2.3: Update Frontend Configuration

**In Bolt Environment Variables:**
```env
VITE_API_URL=https://your-project.railway.app/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Update `src/lib/db.ts`:**
```typescript
const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isBolt = hostname.includes('bolt.host') || hostname.includes('webcontainer');
    
    if (isBolt) {
      // Use deployed backend in Bolt
      return import.meta.env.VITE_API_URL || 'https://your-project.railway.app/api';
    }
  }
  
  // Local development
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};
```

### Phase 3: Update Vite Proxy for Bolt

**File: `vite.config.ts`**

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // In Bolt, proxy to deployed backend
        // In local dev, proxy to localhost
        target: process.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('Proxy error:', err);
          });
        },
      },
    },
  },
});
```

### Phase 4: Hybrid Query Strategy

**Update `src/lib/db.ts` to use hybrid approach:**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseClient = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isBolt = hostname.includes('bolt.host') || hostname.includes('webcontainer');
    
    if (isBolt) {
      // Use deployed backend
      return import.meta.env.VITE_API_URL || 'https://your-project.railway.app/api';
    }
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};

class DatabaseClient {
  private baseUrl: string;
  private useSupabaseDirect: boolean;

  constructor() {
    this.baseUrl = getApiUrl();
    // In Bolt, try Supabase direct first for simple queries
    this.useSupabaseDirect = typeof window !== 'undefined' && 
      (window.location.hostname.includes('bolt.host') || 
       window.location.hostname.includes('webcontainer'));
  }

  from(table: string) {
    // For simple read operations in Bolt, use Supabase direct
    if (this.useSupabaseDirect && supabaseClient) {
      return this.createSupabaseBuilder(table);
    }
    
    // Otherwise, use backend API
    return this.createBackendBuilder(table);
  }

  private createSupabaseBuilder(table: string) {
    // Direct Supabase query builder (Bolt-safe)
    let query = supabaseClient!.from(table);
    let queryParams: any = { select: '*', where: {} };

    return {
      select: (columns: string = '*') => {
        queryParams.select = columns;
        query = query.select(columns);
        return this;
      },
      eq: (column: string, value: any) => {
        queryParams.where[column] = value;
        query = query.eq(column, value);
        return this;
      },
      gte: (column: string, value: any) => {
        query = query.gte(column, value);
        return this;
      },
      lte: (column: string, value: any) => {
        query = query.lte(column, value);
        return this;
      },
      in: (column: string, values: any[]) => {
        query = query.in(column, values);
        return this;
      },
      then: async (resolve?: any, reject?: any) => {
        const { data, error } = await query;
        if (error) {
          if (reject) reject(error);
          return { data: null, error };
        }
        if (resolve) resolve({ data, error: null });
        return { data, error: null };
      },
      // ... other methods
    };
  }

  private createBackendBuilder(table: string) {
    // Existing backend-based builder
    // ... (current implementation)
  }
}
```

## Critical Routes Analysis

### Routes That MUST Use Backend

| Route | Why | Alternative |
|-------|-----|-------------|
| `/api/bookings/create` | PDF generation, Email/WhatsApp | ❌ None |
| `/api/tenants/smtp-settings/test` | SMTP connection (nodemailer) | ❌ None |
| `/api/tenants/whatsapp-settings/test` | WhatsApp API | ❌ None |
| `/api/zoho/*` | OAuth callback, invoice generation | ❌ None |
| `/api/auth/signup` | Password hashing | ✅ Supabase Auth |
| `/api/auth/signin` | JWT generation | ✅ Supabase Auth |

### Routes That Can Use Supabase Direct

| Route | Current | Can Use Supabase? |
|-------|---------|-------------------|
| `/api/query` (simple reads) | Backend | ✅ Yes |
| `/api/tenants/smtp-settings` (GET) | Backend + auth | ⚠️ Yes (with RLS) |
| `/api/tenants/whatsapp-settings` (GET) | Backend + auth | ⚠️ Yes (with RLS) |
| `/api/customers/bookings` | Backend + auth | ✅ Yes (RLS by customer_id) |

## Authentication Strategy

### Option A: Supabase Auth (Recommended for Bolt)

**Pros:**
- ✅ Works in Bolt (no backend needed)
- ✅ Handles password hashing
- ✅ Session management
- ✅ Token refresh

**Implementation:**
```typescript
// src/contexts/AuthContext.tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});

// Get session
const { data: { session } } = await supabase.auth.getSession();

// Use session.access_token for backend API calls
```

### Option B: Keep Backend Auth (Requires Deployed Backend)

**Pros:**
- ✅ Consistent with current implementation
- ✅ Custom JWT claims (role, tenant_id)

**Cons:**
- ❌ Requires backend deployment
- ❌ More complex

## Recommended Implementation Order

### Step 1: Deploy Backend (Critical)
1. Deploy to Railway/Render
2. Configure environment variables
3. Test backend is accessible
4. Update `VITE_API_URL` in Bolt

### Step 2: Update Frontend API URLs
1. Update `getApiUrl()` to use deployed backend in Bolt
2. Test all API calls work

### Step 3: Hybrid Queries (Optional Optimization)
1. Use Supabase direct for simple reads
2. Keep backend for complex operations
3. Improves performance in Bolt

### Step 4: Authentication (Choose One)
- **Option A:** Migrate to Supabase Auth (simpler, Bolt-native)
- **Option B:** Keep backend auth (requires deployed backend)

## Testing Checklist

After implementation:

- [ ] Backend deployed and accessible
- [ ] `VITE_API_URL` set in Bolt environment
- [ ] All `/api/*` routes return 200 (not 404)
- [ ] Authentication works (no 401 errors)
- [ ] Database queries work (no 400 errors)
- [ ] PDF generation works (booking creation)
- [ ] Email sending works (ticket delivery)
- [ ] WhatsApp sending works (if configured)
- [ ] Zoho integration works (OAuth flow)

## Conclusion

**Root Cause:** Architecture assumes backend is always available → fails in Bolt.

**Solution:** Deploy backend externally + update frontend to use deployed URL in Bolt.

**Viability:** ✅ **FULLY VIABLE** - All features preserved, minimal code changes.

**Next Step:** Deploy backend to Railway/Render and update `VITE_API_URL` in Bolt.
