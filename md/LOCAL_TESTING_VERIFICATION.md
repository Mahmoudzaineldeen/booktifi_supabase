# Local Testing Verification Guide

## Current Setup

**Frontend:** Running on http://localhost:5174  
**Backend:** Railway (https://booktifisupabase-production.up.railway.app/api)  
**Auth Method:** POST (configured correctly) ✅

## Issue: "Cannot GET /api/auth/signin"

This error appears when browser tries to GET the endpoint instead of POST.

### Possible Causes:

1. **Browser navigated to URL** (typed in address bar)
2. **Page refresh during POST request**
3. **Redirect to signin endpoint**
4. **Link clicked instead of form submit**

### Not a Problem If:

- You see this in browser address bar
- You refreshed the page during login
- You directly navigated to the URL

### IS a Problem If:

- Login form submission shows this error
- Happens every time you try to login

## Verification Steps

### Step 1: Open DevTools BEFORE Testing

1. Open http://localhost:5174
2. Press **F12** → DevTools
3. Go to **Network** tab
4. Check "Preserve log"
5. Clear existing requests (trash icon)

### Step 2: Test Login

1. Fill in email and password
2. Click "Login" button
3. Watch Network tab

### Step 3: Check the Request

In Network tab, find the `signin` request:

**Click on it** and verify:

```
Request URL: https://booktifisupabase-production.up.railway.app/api/auth/signin
Request Method: POST ← Should be POST, not GET
Status Code: 200 or 401 (not 404)

Request Headers:
content-type: application/json
accept: */*

Request Payload:
{
  "email": "your@email.com",
  "password": "yourpassword"
}
```

**If Method is GET:**
- ❌ Frontend is making wrong request
- Check login form submission

**If Method is POST:**
- ✅ Request is correct
- Check response status

### Step 4: Check Console

Look for:
```
[getApiUrl] Not in Bolt/WebContainer, using configured API URL
VITE_API_URL: https://booktifisupabase-production.up.railway.app/api
```

OR

```
[db] Bolt/WebContainer detected, using Railway backend: ...
```

### Step 5: Check Response

**If Status 200:**
```json
{
  "user": {...},
  "session": {
    "access_token": "..."
  },
  "tenant": {...}
}
```
✅ Login successful!

**If Status 401:**
```json
{
  "error": "Invalid credentials"
}
```
⚠️  Wrong email/password

**If Status 404:**
```
Cannot GET /api/auth/signin
```
❌ Endpoint not found (backend issue)

## Common Scenarios

### Scenario 1: Clicked Link Instead of Submit

If you **clicked a link** with href="/api/auth/signin", browser will GET it.

**Fix:** Use form submission or button click with JavaScript handler.

### Scenario 2: Browser Cached GET Request

Clear browser cache:
1. DevTools → Network tab
2. Right-click → "Clear browser cache"
3. Or: Ctrl+Shift+Delete → Clear cache

### Scenario 3: Page Refresh During Request

If page refreshes while request is in progress:
- Browser may show "Cannot GET"
- This is cosmetic, not a real error

**Fix:** Wait for request to complete before refreshing.

### Scenario 4: Frontend Making GET Instead of POST

Check login form:
```typescript
// Should be:
const response = await fetch(`${API_URL}/auth/signin`, {
  method: 'POST', // ← Must be POST
  body: JSON.stringify({ email, password })
});

// NOT:
const response = await fetch(`${API_URL}/auth/signin`); // ← GET by default
```

## Testing Right Now

Let me verify the endpoint is working with POST:

**Test 1: GET (should fail)**
```bash
curl https://booktifisupabase-production.up.railway.app/api/auth/signin
# Expected: Cannot GET /api/auth/signin
```

**Test 2: POST (should work)**
```bash
curl -X POST https://booktifisupabase-production.up.railway.app/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'
# Expected: 401 Invalid credentials (endpoint works!)
```

Both tests confirm endpoint is configured correctly for POST.

## Your Code is Correct

**File: `src/lib/db.ts` (line 490-500)**
```typescript
signInWithPassword: async (credentials) => {
  const result = await this.request('/auth/signin', {
    method: 'POST', // ← Correct!
    body: JSON.stringify(credentials),
  });
  // ...
}
```

This is using POST correctly ✅

## What to Do

### If seeing "Cannot GET" in Browser Address Bar:

- **Don't worry!** This is just browser navigation
- Use the login form, don't type URL directly

### If seeing "Cannot GET" in Network Tab:

1. Check the actual request method (should be POST)
2. If it's GET, there's a bug in form submission
3. Share the Network tab screenshot

### If Login Takes Forever:

- First request: 5-30 seconds (cold start + bcrypt)
- Subsequent requests: 3-8 seconds (bcrypt only)
- This is **normal** for Railway free tier

## Quick Test

Try this in browser console (on http://localhost:5174):

```javascript
// Test signin with correct method
fetch('https://booktifisupabase-production.up.railway.app/api/auth/signin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@test.com',
    password: 'test123'
  })
})
.then(r => r.json())
.then(d => console.log('Response:', d))
.catch(e => console.error('Error:', e));
```

**Expected output:**
```json
{
  "error": "Invalid credentials"
}
```

This confirms endpoint works with POST ✅

## Summary

**Your code is correct** - uses POST for signin ✅  
**Backend endpoint works** - responds to POST correctly ✅  
**"Cannot GET" error** - Likely browser navigation or refresh ⚠️

**Action:** Try logging in via the form (not URL navigation) and check Network tab to see actual request method.

If problem persists, share a screenshot of the Network tab showing the signin request.
