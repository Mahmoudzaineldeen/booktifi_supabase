# Fix: Row Level Security (RLS) Policy Violation

## Problem
You're seeing: `new row violates row-level security policy for table "tenants"`

**Error Code**: `42501`

## Root Cause
The backend server is using the Supabase **anon key** instead of the **service role key**. The anon key is subject to Row Level Security (RLS) policies, which block certain operations like inserts.

## Solution

### Step 1: Get Your Service Role Key

1. Go to your Supabase project: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Find the **service_role** key (it's marked as "secret")
5. Copy this key

⚠️ **Important**: The service role key has full database access and bypasses RLS. Keep it secret and never expose it to the frontend.

### Step 2: Add to server/.env

Open `server/.env` and add:

```env
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Example:**
```env
SUPABASE_URL=https://zuauohhskeuzjglpkbsm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1YXVvaGhz...
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production
```

### Step 3: Restart the Server

After adding the service role key, restart your server:

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

You should now see:
```
✅ Supabase client initialized: https://zuauohhskeuzjglpkbsm.supabase.co
   Using: SERVICE_ROLE key (bypasses RLS)
```

Instead of:
```
⚠️  WARNING: Using ANON key instead of SERVICE_ROLE key
```

## Why This Happens

- **Anon Key**: Public key for frontend, subject to RLS policies
- **Service Role Key**: Secret key for backend, bypasses RLS

Backend operations (inserts, updates, deletes) need the service role key to bypass RLS policies that protect your database.

## Alternative: Configure RLS Policies

If you prefer to use the anon key, you would need to configure RLS policies in Supabase to allow the operations you need. However, for backend operations, using the service role key is the recommended approach.

## Verify It's Working

After adding the service role key, try the operation again. You should no longer see the RLS error.

## Security Note

- ✅ **DO**: Use service role key in `server/.env` (backend only)
- ✅ **DO**: Keep `server/.env` in `.gitignore`
- ❌ **DON'T**: Expose service role key to frontend
- ❌ **DON'T**: Commit service role key to git

The service role key is automatically ignored by git if your `.gitignore` includes `.env` files.
