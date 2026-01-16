# Quick Fix: RLS Error for Inserts

## The Problem
You're getting: `new row violates row-level security policy for table "tenants"`

This happens because the backend is using the **anon key** which is subject to RLS policies.

## The Solution

**You MUST use the SERVICE_ROLE key, NOT the anon key for backend operations.**

The anon key will NOT work for inserts/updates/deletes because RLS blocks them.

### Step 1: Get Service Role Key

1. Go to: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Find **service_role** key (it's marked as "secret" - it's a long JWT token)
5. Copy the entire key

### Step 2: Add to server/.env

Open `server/.env` and add:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1YXVvaGhz...
```

**Important**: 
- Use the FULL key (it's very long, starts with `eyJ...`)
- Don't use quotes around it
- Make sure there are no spaces

### Step 3: Restart Server

```bash
# Stop server (Ctrl+C)
npm run dev
```

### Step 4: Verify

You should see in the console:
```
✅ Supabase client initialized: https://zuauohhskeuzjglpkbsm.supabase.co
   Using: SERVICE_ROLE key (bypasses RLS)
```

If you see:
```
⚠️  WARNING: Using ANON key instead of SERVICE_ROLE key
```

Then the service role key is not set correctly.

## Why Anon Key Won't Work

- **Anon Key**: Public key, subject to RLS → Blocks inserts/updates/deletes
- **Service Role Key**: Secret key, bypasses RLS → Allows all operations

For backend operations, you MUST use the service role key.

## Troubleshooting

### "Still getting RLS error after adding service role key"

1. **Check the key is correct:**
   - Make sure you copied the FULL key (it's very long)
   - No quotes, no spaces
   - Starts with `eyJ`

2. **Check server/.env exists:**
   ```bash
   # Verify file exists
   Test-Path server/.env
   ```

3. **Restart the server** after adding the key

4. **Check console output:**
   - Should say "SERVICE_ROLE key (bypasses RLS)"
   - Not "ANON key (subject to RLS)"

### "Can't find service_role key in Supabase"

- Make sure you're looking at **Settings** → **API**
- Scroll down to find "service_role" key
- It's marked as "secret" and is much longer than the anon key

## Security Note

- ✅ **DO**: Keep service role key in `server/.env` (backend only)
- ✅ **DO**: Add `server/.env` to `.gitignore` (if not already)
- ❌ **DON'T**: Commit service role key to git
- ❌ **DON'T**: Use service role key in frontend code
