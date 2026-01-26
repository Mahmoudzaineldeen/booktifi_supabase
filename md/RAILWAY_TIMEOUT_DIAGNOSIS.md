# Railway Backend Timeout Diagnosis

## Issue: "Request is taking longer than expected"

This message appears when API requests take too long to respond.

### Possible Causes

1. **Railway Cold Start** (Most likely)
   - Railway services can "sleep" after inactivity
   - First request wakes up the service (takes 5-30 seconds)
   - Subsequent requests are fast

2. **Database Query Timeout**
   - Complex queries take time
   - Multiple joins/foreign key relations
   - Large datasets

3. **Frontend Timeout Configuration**
   - Frontend may have short timeout (10-30 seconds)
   - Railway backend needs more time for cold start

4. **Network Latency**
   - Railway US West → Your location
   - Can add 300-800ms per request

## Quick Diagnosis

### Check Railway Service Status

1. Go to Railway Dashboard → Your Service
2. Check if service is "Sleeping" or "Running"
3. If sleeping, first request will take 20-30 seconds

### Check Railway Logs

Look for:
```
[Request] Received request for /api/...
[Request] Processing...
[Response] Sent response
```

If you see long gaps, it's processing time.

## Solutions

### Solution 1: Keep Railway Service Awake (Recommended)

Railway free tier services sleep after inactivity. To prevent:

**Option A: Add Healthcheck Pings**

Create a cron job or external monitor:
```bash
# Ping every 5 minutes to keep alive
curl https://booktifisupabase-production.up.railway.app/health
```

**Option B: Upgrade Railway Plan**

Pro plan keeps services always running (no cold starts)

**Option C: Add Keep-Alive Endpoint**

Already have `/health` - just need to ping it regularly.

### Solution 2: Increase Frontend Timeout

**File: `src/lib/db.ts`** - Already has long timeouts:

```typescript
const baseTimeout = url.startsWith('/') ? 30000 : 10000; // 30s for relative URLs
```

Should be sufficient for cold starts.

### Solution 3: Add Loading States

Show "Waking up backend..." message for first request:

```typescript
// In API request
try {
  setLoading(true);
  setLoadingMessage('Connecting to server...');
  
  const response = await fetch(API_URL, {
    signal: AbortSignal.timeout(60000) // 60 second timeout
  });
  
  // ...
} catch (error) {
  if (error.name === 'TimeoutError') {
    setError('Request timed out. Backend may be starting up, please try again.');
  }
}
```

## Expected Response Times

### First Request (Cold Start)
- **Railway wakes up**: 5-20 seconds
- **Backend starts**: 3-10 seconds
- **Total**: 10-30 seconds ⏳

### Subsequent Requests (Warm)
- **API calls**: 300-800ms ✅
- **Database queries**: 500-1500ms ✅
- **Complex operations**: 1-5 seconds ✅

## Testing Right Now

Let me check current response times:

```bash
# Test 1: Health check
time curl https://booktifisupabase-production.up.railway.app/health

# Test 2: API endpoint
time curl https://booktifisupabase-production.up.railway.app/api/health
```

If both return in < 1 second, service is warm ✅  
If taking 10+ seconds, service is doing cold start ⏳

## Immediate Actions

### 1. Wait for First Request

If this is first request after deployment:
- **Wait 30-60 seconds** for cold start
- Service will stay warm after first request
- Subsequent requests will be fast

### 2. Check Browser Console

Look for errors:
- Timeout errors
- Connection refused
- CORS errors

### 3. Check Network Tab

See which specific endpoint is slow:
- `/api/query` - Database queries
- `/api/tenants/*` - Tenant settings
- `/api/auth/*` - Authentication

## Frontend Timeout Configuration

**Current in `src/lib/db.ts`:**

```typescript
// Line ~47-49
const baseTimeout = url.startsWith('/') ? 30000 : 10000;
const isTenantQuery = endpoint.includes('tenants') || ...;
const timeoutMs = isTenantQuery ? baseTimeout * 2 : baseTimeout;
```

**Timeouts:**
- Regular queries: 10 seconds
- Tenant queries: 20 seconds
- Relative URLs (Bolt): 30-60 seconds

These should be sufficient for cold starts.

## Railway Service Configuration

### Current Settings:
- **Instance**: 2 vCPU, 1 GB Memory ✅
- **Region**: US West (California) ✅
- **Restart Policy**: On Failure ✅

### Recommended Additions:
- **Healthcheck Path**: `/health` (keeps service warm)
- **Minimum Instances**: 1 (prevents sleeping - Pro plan only)

## Monitoring

### Check Railway Metrics

Railway Dashboard → Your Service → Metrics:
- CPU usage
- Memory usage
- Request count
- Response times

If CPU/Memory are high, service may be struggling.

## Alternative: Use Railway Pro

**Railway Pro Plan** ($5-20/month):
- ✅ No cold starts (always running)
- ✅ Faster response times
- ✅ Better for production

**Hobby Plan** (Free tier):
- ⚠️  Cold starts after inactivity
- ⚠️  First request takes 10-30 seconds
- ✅ Subsequent requests are fast

## Summary

**"Request is taking longer than expected"** is most likely:
1. Railway cold start (first request after inactivity)
2. Wait 30-60 seconds
3. Subsequent requests will be fast

**Actions:**
1. Wait for first request to complete
2. Check Railway logs for any errors
3. Ping `/health` regularly to keep service warm
4. Consider Railway Pro for no cold starts

**Expected:** After first request, everything should be fast (< 1 second)
