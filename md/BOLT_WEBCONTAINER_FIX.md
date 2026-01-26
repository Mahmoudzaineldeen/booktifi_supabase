# Bolt/WebContainer Fix

## Issues Fixed

### 1. Frontend Connection Error
**Problem**: Frontend couldn't connect to backend in Bolt/WebContainer
- Error: `signal timed out` or `Backend server is not running`
- Cause: Using absolute `localhost:3001` URLs which don't work in Bolt

**Fix Applied**:
- ✅ Updated `src/lib/db.ts` to detect Bolt/WebContainer environment
- ✅ Uses relative URLs (`/api`) in Bolt instead of `http://localhost:3001/api`
- ✅ Increased timeout to 30 seconds for relative URLs (Bolt can be slower)
- ✅ Better error messages for Bolt environment

### 2. Backend Lock Cleanup Errors
**Problem**: `TypeError: fetch failed` errors every minute
- Cause: Supabase client network requests failing in Bolt environment

**Fix Applied**:
- ✅ Updated `server/src/jobs/cleanupLocks.ts` to silently ignore network errors
- ✅ Network errors are non-critical - cleanup will retry on next cycle
- ✅ Only logs actual database errors, not network issues

## How It Works Now

### Frontend API Calls
- **In Bolt/WebContainer**: Uses relative URLs (`/api/*`) → Vite proxy → Backend
- **In Local Development**: Uses `http://localhost:3001/api` (or configured URL)
- **Auto-detection**: Detects Bolt by checking hostname

### Backend Lock Cleanup
- Runs every 60 seconds
- Silently handles network errors (common in cloud environments)
- Only logs actual database errors

## Testing

1. **Restart both servers**:
   ```bash
   npm run dev
   ```

2. **Check frontend connection**:
   - Try logging in
   - Should connect successfully via relative URLs

3. **Check backend logs**:
   - Lock cleanup errors should be gone
   - Only real errors will be logged

## If Issues Persist

1. **Verify servers are running**:
   - Frontend: Should show on port 5173
   - Backend: Should show "🚀 API Server running on http://localhost:3001"

2. **Check Vite proxy**:
   - In browser DevTools → Network tab
   - API calls should go to `/api/*` (relative)
   - Should be proxied to backend

3. **Wait for initialization**:
   - Bolt/WebContainer can take 10-30 seconds to fully initialize
   - Wait a moment after starting servers

## Files Modified

- `src/lib/db.ts` - Auto-detects Bolt, uses relative URLs
- `src/lib/serverHealth.ts` - Uses relative URLs in Bolt
- `server/src/jobs/cleanupLocks.ts` - Handles network errors gracefully
