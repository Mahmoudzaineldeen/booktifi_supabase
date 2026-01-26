# Zoho Token Auto-Refresh - Permanent Solution

## ✅ Problem Solved

**Issue**: Zoho access tokens expire after ~1 hour, requiring manual reconnection.

**Solution**: Automatic background job that proactively refreshes tokens before they expire.

## 🔧 Implementation

### 1. Background Token Refresh Job

**File**: `server/src/jobs/zohoTokenRefresh.ts`

- **Runs every 10 minutes** (configurable via `ZOHO_TOKEN_REFRESH_INTERVAL`)
- **Refreshes tokens** that expire within **15 minutes**
- **Automatic and transparent** - no manual intervention needed
- **Handles all tenants** - refreshes tokens for all configured tenants

### 2. How It Works

```
┌─────────────────────────────────────────────────┐
│  Background Job (Every 10 minutes)             │
│                                                 │
│  1. Check all Zoho tokens in database          │
│  2. Find tokens expiring within 15 minutes    │
│  3. For each expiring token:                   │
│     - Call getAccessToken()                     │
│     - Automatically refreshes using            │
│       refresh_token                             │
│     - Updates database with new token          │
│  4. Log results                                 │
└─────────────────────────────────────────────────┘
```

### 3. Integration

**File**: `server/src/index.ts`

The job is automatically started when the server starts:

```typescript
// Start Zoho token refresh worker (runs every 10 minutes)
const tokenRefreshInterval = process.env.ZOHO_TOKEN_REFRESH_INTERVAL
  ? parseInt(process.env.ZOHO_TOKEN_REFRESH_INTERVAL)
  : 10 * 60 * 1000; // 10 minutes
startZohoTokenRefresh(tokenRefreshInterval);
```

## 🎯 Benefits

### ✅ Permanent Solution
- **No manual refresh needed** - tokens are refreshed automatically
- **Always valid tokens** - refreshed 15 minutes before expiration
- **Zero downtime** - tokens refreshed in background

### ✅ Proactive Refresh
- **15-minute buffer** - tokens refreshed well before expiration
- **Prevents failures** - invoices always work, no expired token errors
- **Seamless operation** - users never notice token refresh

### ✅ Multi-Tenant Support
- **All tenants handled** - refreshes tokens for all configured tenants
- **Per-tenant isolation** - each tenant's tokens refreshed independently
- **Error handling** - if one tenant's refresh fails, others continue

## 📊 Monitoring

### Server Logs

When tokens are refreshed, you'll see:

```
[ZohoTokenRefresh] Checking for tokens expiring before 2026-01-23T15:30:00.000Z...
[ZohoTokenRefresh] Found 2 token(s) that need refreshing
[ZohoTokenRefresh] Refreshing token for tenant abc-123 (expires in 12 minutes)...
[ZohoService] Token expires soon (12 minutes), refreshing for tenant abc-123...
[ZohoService] ✅ Token refreshed successfully
[ZohoTokenRefresh] ✅ Successfully refreshed token for tenant abc-123
[ZohoTokenRefresh] ✅ Completed: 2 refreshed, 0 failed
```

### If Refresh Fails

If a refresh token is invalid (user needs to reconnect):

```
[ZohoTokenRefresh] ❌ Failed to refresh token for tenant abc-123: Refresh token is invalid
[ZohoTokenRefresh] ⚠️  Refresh token is invalid for tenant abc-123
[ZohoTokenRefresh]    User needs to reconnect Zoho in Settings → Zoho Integration
```

## ⚙️ Configuration

### Environment Variables

**`ZOHO_TOKEN_REFRESH_INTERVAL`** (optional)
- Default: `600000` (10 minutes)
- How often the job runs
- Value in milliseconds

Example:
```bash
ZOHO_TOKEN_REFRESH_INTERVAL=300000  # Run every 5 minutes
```

### Refresh Threshold

Currently set to **15 minutes** - tokens expiring within 15 minutes are refreshed.

This can be adjusted in `zohoTokenRefresh.ts`:

```typescript
// Refresh tokens that expire within 15 minutes (900 seconds)
const refreshThreshold = new Date(now.getTime() + 15 * 60 * 1000);
```

## 🔄 Token Lifecycle

### Before Fix:
```
Token Created → Valid for 1 hour → Expires → ❌ Invoices Fail → Manual Reconnect Needed
```

### After Fix:
```
Token Created → Valid for 1 hour → Auto-Refreshed at 45 min → New Token (1 hour) → Auto-Refreshed → ...
```

**Result**: Tokens are **always valid** - never expire!

## 🚀 Deployment

1. **Deploy the code** - includes new background job
2. **Restart server** - job starts automatically
3. **Monitor logs** - verify tokens are being refreshed
4. **No configuration needed** - works out of the box

## ✅ Verification

After deployment, check server logs for:

```
🔄 Zoho token auto-refresh enabled (runs every 10 minutes)
   Tokens will be refreshed automatically 15 minutes before expiration
```

Then wait 10 minutes and check for refresh activity:

```
[ZohoTokenRefresh] Checking for tokens expiring before...
[ZohoTokenRefresh] Found X token(s) that need refreshing
[ZohoTokenRefresh] ✅ Successfully refreshed token for tenant...
```

## 🎉 Result

**Permanent Solution Achieved!**

- ✅ Tokens never expire (auto-refreshed before expiration)
- ✅ No manual intervention needed
- ✅ Invoices always work
- ✅ Zero downtime
- ✅ Transparent to users

---

**Status**: ✅ **PERMANENTLY FIXED**

The system now automatically maintains valid Zoho tokens forever, as long as the refresh token remains valid. Users only need to reconnect if the refresh token itself expires (which is rare and typically only happens if Zoho account settings change).
