# JWT Token Validation & Creation Fix

## Problem
Users were experiencing 401 (Unauthorized) and 400 (Bad Request) errors due to:
1. Tokens created with missing required fields
2. Invalid token format stored in localStorage
3. Missing Authorization headers
4. Incorrect tenant_id handling

## Solution Implemented

### 1. Backend Token Creation Validation

**File:** `server/src/routes/auth.ts`

**Changes:**
- ✅ Added validation for required fields (`id`, `role`) before creating tokens
- ✅ Ensured `tenant_id` is handled correctly (null is valid for `solution_owner`)
- ✅ Added comprehensive logging for token creation
- ✅ Improved error messages when token creation fails

**Token Payload Structure:**
```typescript
{
  id: string;           // Required - User ID
  email: string | null; // Optional - User email
  role: string;        // Required - User role
  tenant_id: string | null; // Optional - null for solution_owner
}
```

**Validation:**
- Checks `id` exists before creating token
- Checks `role` exists before creating token
- Returns 500 error with clear message if validation fails
- Logs token creation success with user details

### 2. Frontend Token Storage Validation

**File:** `src/lib/db.ts`

**Changes:**
- ✅ Validates token exists before storing in localStorage
- ✅ Validates token format (JWT has 3 parts)
- ✅ Clears invalid tokens automatically
- ✅ Improved error messages for missing tokens
- ✅ Added logging for token storage

**Token Storage:**
- Validates `access_token` exists in session response
- Validates token format (JWT: `header.payload.signature`)
- Stores token only if valid
- Logs storage success/failure

### 3. Request Authorization Header

**File:** `src/lib/db.ts` - `request()` method

**Changes:**
- ✅ Validates token format before attaching to requests
- ✅ Trims token whitespace
- ✅ Only adds Authorization header if token is valid
- ✅ Improved header construction

**Authorization Header:**
- Format: `Authorization: Bearer <token>`
- Only added if token exists and is valid
- Token is trimmed to remove whitespace

### 4. Tenant ID Handling

**File:** `server/src/routes/tenants.ts`

**Changes:**
- ✅ Changed `req.user!.tenant_id` to `req.user?.tenant_id`
- ✅ Added validation for missing tenant_id (except solution_owner)
- ✅ Improved error messages for missing tenant_id
- ✅ Handles solution_owner with null tenant_id correctly

**Tenant ID Logic:**
- `solution_owner`: Can have `null` tenant_id (system-wide access)
- Other roles: Must have `tenant_id` for tenant-specific routes
- Returns 400 error with helpful message if tenant_id missing

## Token Creation Flow

### Sign In Flow
1. User provides credentials
2. Backend validates credentials
3. Backend validates user data (id, role)
4. Backend creates JWT token with validated payload
5. Backend returns token in `session.access_token`
6. Frontend validates token exists
7. Frontend validates token format
8. Frontend stores token in localStorage
9. Frontend attaches token to all subsequent requests

### Token Refresh Flow
1. Frontend calls `/auth/refresh` with current token
2. Backend validates token (even if expired)
3. Backend fetches latest user data
4. Backend creates new token with validated payload
5. Frontend updates stored token

## Error Prevention

### 401 Unauthorized Errors
**Prevented by:**
- ✅ Validating token format before storage
- ✅ Ensuring Authorization header is properly formatted
- ✅ Validating required fields in token payload
- ✅ Handling expired tokens gracefully

### 400 Bad Request Errors
**Prevented by:**
- ✅ Validating tenant_id exists (except solution_owner)
- ✅ Providing clear error messages
- ✅ Validating token payload structure

## Testing Checklist

After deployment, verify:
- [ ] Sign in creates valid token
- [ ] Token is stored in localStorage
- [ ] Token is attached to API requests
- [ ] Protected routes accept valid tokens
- [ ] Invalid tokens are rejected with 401
- [ ] Missing tenant_id returns helpful error (not 500)
- [ ] solution_owner can access routes without tenant_id
- [ ] Token refresh works correctly

## Logging

All token operations are logged:
- ✅ Token creation: User ID, role, hasTenantId
- ✅ Token storage: Has token, token length
- ✅ Token validation: Format validation results
- ✅ Token errors: Clear error messages

## Environment Variables

Ensure `JWT_SECRET` is set in:
- ✅ Railway backend environment
- ✅ Local development (if testing locally)
- ✅ Must match between environments

**Note:** If `JWT_SECRET` differs between environments, tokens created in one environment won't validate in another.

## Summary

This fix ensures:
1. ✅ Tokens are always created with required fields
2. ✅ Tokens are validated before storage
3. ✅ Tokens are properly attached to requests
4. ✅ Missing tenant_id is handled correctly
5. ✅ Clear error messages for debugging

**Result:** Users should no longer experience 401/400 errors due to token issues.
