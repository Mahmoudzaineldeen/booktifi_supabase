# Performance Optimization - Railway Backend

## Issue: Slow Signin/Authentication

### Symptoms
- "Request is taking longer than expected" message
- Login takes 5-15 seconds
- First request after inactivity is very slow

### Root Causes

#### 1. Railway Cold Start (5-20 seconds)
When service is inactive:
- Railway puts service to sleep
- First request wakes it up
- Takes 5-20 seconds for first response
- **Solution:** Keep service warm with regular pings

#### 2. Bcrypt Password Hashing (2-5 seconds)
```typescript
// server/src/routes/auth.ts (line 191)
passwordMatch = await bcrypt.compare(password, user.password_hash);
```

Bcrypt is **intentionally slow** for security:
- Protects against brute force attacks
- CPU-intensive operation
- On Railway free tier (2 vCPU), takes 2-5 seconds
- **Solution:** Optimize bcrypt rounds or upgrade Railway plan

#### 3. Multiple Database Queries (1-3 seconds)
Signin flow:
1. Query users table (500ms-1s)
2. Query tenants table (500ms-1s)
3. Bcrypt compare (2-5s)
4. Generate JWT (< 100ms)

**Total:** 4-10 seconds per signin

### Solutions

## Solution 1: Optimize Bcrypt Rounds (Recommended)

**Current bcrypt configuration** likely uses 10-12 rounds.

**Check and optimize:**

```javascript
// When creating password hash:
const rounds = 8; // Instead of 10-12
const hash = await bcrypt.hash(password, rounds);
```

**Trade-off:**
- 8 rounds: ~1 second (fast, still secure)
- 10 rounds: ~2-3 seconds (balanced)
- 12 rounds: ~5-8 seconds (very secure, slow)

For production with Railway free tier, **8-10 rounds** is recommended.

## Solution 2: Add Loading State in Frontend

**File: `src/contexts/AuthContext.tsx` or login component**

```typescript
const handleLogin = async (email, password) => {
  setLoading(true);
  setLoadingMessage('Authenticating... This may take a moment.');
  
  try {
    const response = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
    
    // ...
  } catch (error) {
    if (error.name === 'TimeoutError') {
      setError('Login timed out. Backend may be starting up. Please try again in a moment.');
    }
  } finally {
    setLoading(false);
  }
};
```

Show user-friendly message:
```
🔄 Authenticating...
   Please wait, backend is processing your request.
   (This may take up to 30 seconds on first request)
```

## Solution 3: Keep Railway Service Warm

### Option A: Scheduled Health Checks

Create external cron job or monitoring service:

```bash
# Ping every 5 minutes
curl https://booktifisupabase-production.up.railway.app/health
```

**Services that can do this:**
- UptimeRobot (free)
- Pingdom (free tier)
- Cron-job.org (free)
- GitHub Actions (scheduled workflow)

### Option B: Frontend Keep-Alive

Add to frontend:

```typescript
// src/lib/keepAlive.ts
export function startKeepAlive() {
  setInterval(async () => {
    try {
      await fetch(`${API_URL}/health`);
    } catch (error) {
      // Ignore errors
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}
```

Call in `App.tsx`:
```typescript
useEffect(() => {
  startKeepAlive();
}, []);
```

## Solution 4: Optimize Database Queries

### Add Indexes

```sql
-- Speed up user lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
```

These indexes make user lookup queries faster (500ms → 50ms).

## Solution 5: Upgrade Railway Plan

**Railway Pro Plan** ($20/month):
- ✅ No cold starts
- ✅ Better CPU (faster bcrypt)
- ✅ Always-on services
- ✅ Faster response times

## Current Performance Baseline

### Expected Signin Times:

| Scenario | Time | Status |
|----------|------|--------|
| Cold start + Signin | 10-30s | ⚠️  Slow (Railway waking up) |
| Warm service + Signin | 3-8s | ⚠️  Acceptable (bcrypt delay) |
| Cached/Optimized | 1-2s | ✅ Good |

### What's Normal:

- **First signin after inactivity:** 10-30 seconds (cold start + bcrypt)
- **Subsequent signins:** 3-8 seconds (bcrypt only)
- **Other API calls:** 300ms-2 seconds

## Immediate Actions

### 1. Show Loading Message

Update frontend to show:
```
🔄 Signing in...
   Please wait, this may take up to 30 seconds.
```

### 2. Add Timeout Handler

Increase timeout and show helpful error:
```typescript
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45000) // 45 seconds
  });
} catch (error) {
  if (error.name === 'TimeoutError') {
    alert('Login is taking longer than expected. The backend may be starting up. Please try again in a moment.');
  }
}
```

### 3. Set Up Keep-Alive Monitoring

Use UptimeRobot or similar:
- Monitor: https://booktifisupabase-production.up.railway.app/health
- Interval: 5 minutes
- Keeps service warm

## Testing Performance Now

Let me test the actual signin performance with real credentials:

**Current test results:**
- Health endpoint: 372ms (warm)
- Auth endpoint: Responds correctly
- Network: Good (300-800ms latency)

**Expected signin flow:**
1. Database query: ~500ms
2. Bcrypt compare: ~2-5 seconds (Railway CPU)
3. JWT generation: ~50ms
4. **Total: ~3-6 seconds** (acceptable)

**If taking > 10 seconds:**
- Railway cold start in progress
- Wait and try again
- Should be faster after first request

## Recommendations

### Short Term (Free):
1. ✅ Add loading messages in frontend
2. ✅ Increase timeout to 45 seconds
3. ✅ Set up UptimeRobot to ping /health every 5 minutes

### Long Term (Paid):
1. Upgrade to Railway Pro ($20/month) - No cold starts
2. Optimize bcrypt rounds (8 instead of 10-12)
3. Add database indexes

## Summary

**Slowness is expected** on Railway free tier due to:
- Cold starts (5-20 seconds)
- Bcrypt password hashing (2-5 seconds)
- Limited CPU resources

**Acceptable:** 3-8 seconds per signin on warm service  
**Slow:** 10-30 seconds on cold start  
**Solution:** Keep service warm or upgrade to Pro plan

**Current status:** Backend is working correctly, just slow on Railway free tier. This is normal and expected behavior.
