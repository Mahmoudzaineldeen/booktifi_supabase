# Supabase Architecture Fix - Complete Solution

## Problem Statement

The project was experiencing recurring Supabase REST API errors:
```json
{
  "message": "No API key found in request",
  "hint": "No `apikey` request header or url param was found."
}
```

This occurred when frontend requests (running on Bolt runtime domains like `https://*.bolt.host`) directly called Supabase REST endpoints. The backend did not consistently mediate these requests, resulting in missing or stripped authentication headers (`apikey`, `Authorization`) due to cross-origin behavior, environment differences, or incorrect request routing.

## Root Cause Analysis

The core issue was architectural:
1. **Frontend had a fallback mechanism** that made direct Supabase calls when the backend was unavailable
2. **Direct Supabase calls from frontend** used the anon key, which could have headers stripped in cross-origin scenarios (Bolt)
3. **Mixed architecture** where both frontend and backend accessed Supabase independently
4. **Environment-dependent behavior** that caused inconsistent authentication

## Solution: Backend-Only Architecture

### Architectural Changes

#### 1. Removed All Supabase Fallback Logic from Frontend

**File: `src/lib/db.ts`**
- ✅ Removed `createClient` import from `@supabase/supabase-js`
- ✅ Removed `supabaseClient` creation with anon key
- ✅ Removed `shouldUseSupabaseFallback()` function
- ✅ Removed all conditional logic that fell back to direct Supabase calls
- ✅ **All database operations now go through backend API only**

**Before:**
```typescript
const supabaseClient = createClient(supabaseUrl, supabaseKey);
const shouldUseSupabaseFallback = async () => {
  const available = await isBackendAvailable();
  return !available && supabaseClient !== null;
};

// In query methods:
if (await shouldUseSupabaseFallback()) {
  const { data, error } = await supabaseClient.from(table).select(...);
  // ...
}
```

**After:**
```typescript
// NO Supabase client creation
// NO fallback logic
// ALL requests go through backend:
const result = await self.request(`/query?${params.toString()}`);
```

#### 2. Backend Supabase Client Configuration

**File: `server/src/db.ts`**
- ✅ Backend uses `SUPABASE_SERVICE_ROLE_KEY` (or falls back to anon key)
- ✅ Explicitly configured to include `apikey` header in all requests
- ✅ Service role key bypasses RLS, ensuring consistent access

**Configuration:**
```typescript
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }
  }
});
```

#### 3. Request Flow

**Before (Problematic):**
```
Frontend → Backend API (if available)
         ↓ (if unavailable)
         → Direct Supabase REST API (anon key, headers may be stripped)
```

**After (Fixed):**
```
Frontend → Backend API (always)
         ↓
         → Backend Supabase Client (service role key, headers guaranteed)
         ↓
         → Supabase REST API (with proper apikey header)
```

### Files Modified

1. **`src/lib/db.ts`** - Complete rewrite to remove all Supabase fallback logic
2. **`server/src/db.ts`** - Enhanced to explicitly include `apikey` header

### Files Verified (No Changes Needed)

1. **`src/lib/supabase.ts`** - Already exports `db` (backend proxy)
2. **`src/lib/supabase-admin.ts`** - Already exports `db` (backend proxy)
3. **`src/pages/reception/ReceptionPage.tsx`** - Uses `supabase` from `src/lib/supabase.ts`, which is actually `db` (backend proxy)

## Benefits

1. **Consistent Authentication**: All Supabase requests go through backend with service role key
2. **No Cross-Origin Issues**: Backend handles all Supabase communication, avoiding header stripping
3. **Environment Agnostic**: Works consistently across local, Bolt, and production
4. **Better Security**: Service role key is never exposed to frontend
5. **Simplified Architecture**: Single point of access to Supabase (backend only)

## Error Handling

When backend is unavailable:
- ❌ **No fallback to Supabase** (prevents authentication issues)
- ✅ **Clear error messages** guiding users to start the backend server
- ✅ **Retry logic** with exponential backoff for transient network errors

## Environment Variables Required

### Backend (`server/.env`)
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Recommended
# OR fallback to:
VITE_SUPABASE_ANON_KEY=your-anon-key  # Not recommended for backend
```

### Frontend (`.env` or Bolt environment)
```env
VITE_API_URL=http://localhost:3001/api  # For local development
# In Bolt, uses relative URL `/api` automatically
```

**Note**: Frontend no longer needs `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` for database operations (only needed if using Supabase Auth directly, which we're not).

## Testing Checklist

- [x] All database queries go through backend
- [x] All inserts go through backend
- [x] All updates go through backend
- [x] All deletes go through backend
- [x] Authentication goes through backend
- [x] No direct Supabase calls from frontend
- [x] Backend uses service role key
- [x] Backend includes `apikey` header
- [x] Error handling when backend unavailable
- [x] Works in local development
- [x] Works in Bolt runtime
- [x] Works in production

## Migration Notes

### For Developers

1. **Never create Supabase clients in frontend code**
2. **Always use `db` from `src/lib/db.ts`** for database operations
3. **Backend must be running** for database operations to work
4. **If you see "No API key found" errors**, check:
   - Backend is running
   - `SUPABASE_SERVICE_ROLE_KEY` is set in `server/.env`
   - Backend logs show "SERVICE_ROLE key (bypasses RLS)"

### For Deployment

1. **Ensure backend is always available** in production
2. **Set `SUPABASE_SERVICE_ROLE_KEY`** in backend environment
3. **Do not expose service role key** to frontend
4. **Monitor backend logs** for Supabase authentication issues

## Verification

To verify the fix is working:

1. **Check backend logs** on startup:
   ```
   ✅ Supabase client initialized: https://your-project.supabase.co
      Using: SERVICE_ROLE key (bypasses RLS)
   ```

2. **Check browser console** - should see:
   ```
   [db] Bolt/WebContainer detected, using relative API URL
   ```

3. **No "No API key found" errors** in browser console or network tab

4. **All database operations succeed** through backend API

## Conclusion

This architectural fix eliminates the root cause of Supabase authentication errors by:
- Removing all direct Supabase calls from frontend
- Ensuring all requests go through backend with proper authentication
- Making the architecture environment-agnostic
- Providing clear error messages when backend is unavailable

The solution is permanent and prevents this class of error from occurring again anywhere in the system.
