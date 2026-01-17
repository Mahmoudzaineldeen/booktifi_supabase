# Duplicate Key Error Fix - Users and Tenants Tables

## ✅ Issue Fixed

**Problem**: Inserting records with existing unique keys caused duplicate key errors (code 23505) that crashed operations.

**Errors**:
1. Users table: `duplicate key value violates unique constraint "users_pkey"` - Key (id) already exists
2. Tenants table: `duplicate key value violates unique constraint "tenants_slug_key"` - Key (slug) already exists

**Solution**: Updated the insert endpoint to use `upsert()` for both `users` and `tenants` tables, which handles duplicate keys gracefully.

---

## 🔧 Changes Made

### File: `server/src/routes/query.ts`

#### 1. Added Upsert for Users and Tenants Tables

**Before**:
```typescript
let query = supabase.from(table).insert(records);
```

**After**:
```typescript
// For users table, use upsert to handle duplicate IDs gracefully
if (table === 'users') {
  // Use upsert with conflict resolution on 'id' column
  query = supabase.from(table).upsert(records, { 
    onConflict: 'id',
    ignoreDuplicates: false 
  });
} else if (table === 'tenants') {
  // For tenants table, use upsert to handle duplicate slugs gracefully
  query = supabase.from(table).upsert(records, { 
    onConflict: 'slug',
    ignoreDuplicates: false 
  });
} else {
  query = supabase.from(table).insert(records);
  // ... other table handling
}
```

#### 2. Added Fallback for Duplicate Errors

**Added**:
```typescript
// Handle unique constraint violations
if (error.code === '23505') {
  // For users table, try to return the existing record instead of error
  if (table === 'users' && records.length === 1 && records[0].id) {
    // Fetch and return existing user...
  }
  
  // For tenants table, try to return the existing record instead of error
  if (table === 'tenants' && records.length === 1) {
    // Try to find by slug first (most common conflict)
    const slug = records[0].slug;
    if (slug) {
      const { data: existingTenant } = await supabase
        .from('tenants')
        .select(...)
        .eq('slug', slug)
        .single();
      // Return existing tenant...
    }
    // Fallback: try by ID if provided...
  }
  // ... rest of error handling
}
```

---

## 📋 How It Works

### Upsert Behavior

**Users Table**:
1. **If user doesn't exist**: Inserts new user record
2. **If user exists (same ID)**: Updates existing user record with new data
3. **If upsert fails**: Falls back to fetching and returning existing record by ID

**Tenants Table**:
1. **If tenant doesn't exist**: Inserts new tenant record
2. **If tenant exists (same slug)**: Updates existing tenant record with new data
3. **If upsert fails**: Falls back to fetching and returning existing record by slug (or ID)

### Benefits

- ✅ No more duplicate key errors for users and tenants tables
- ✅ Graceful handling of existing records
- ✅ Updates existing records instead of failing
- ✅ Returns existing record if update fails
- ✅ Handles both ID conflicts (users) and slug conflicts (tenants)

---

## 🧪 Testing

### Test Case 1: Insert New User
```json
POST /api/query/insert/users
{
  "data": {
    "id": "new-uuid",
    "email": "new@example.com",
    "full_name": "New User",
    "role": "tenant_admin"
  }
}
```
**Expected**: User inserted successfully

### Test Case 2: Insert Existing User (Duplicate ID)
```json
POST /api/query/insert/users
{
  "data": {
    "id": "e52619a9-318e-47a0-8245-c5f373916eaa",
    "email": "11@gmail.com",
    "full_name": "11 Admin",
    "role": "tenant_admin"
  }
}
```
**Expected**: 
- User record updated (if upsert works)
- OR existing user record returned (if upsert fails)

### Test Case 3: Insert Existing Tenant (Duplicate Slug)
```json
POST /api/query/insert/tenants
{
  "data": {
    "name": "11",
    "slug": "11",
    "industry": "restaurant",
    "contact_email": "11@gmail.com"
  }
}
```
**Expected**: 
- Tenant record updated (if upsert works)
- OR existing tenant record returned (if upsert fails)

### Test Case 4: Insert User Without ID
```json
POST /api/query/insert/users
{
  "data": {
    "email": "test@example.com",
    "full_name": "Test User",
    "role": "tenant_admin"
  }
}
```
**Expected**: New user created with auto-generated ID

---

## ⚠️ Notes

1. **Upsert Updates All Fields**: When a record with the same unique key exists, upsert will update ALL provided fields. Make sure to include all required fields in the request.

2. **Tenants Slug Generation**: If a tenant is inserted without a slug, the system should generate one. If a slug conflict occurs, upsert will update the existing tenant.

3. **Other Tables Unchanged**: Only the `users` and `tenants` tables use upsert. Other tables (like `package_services`, `employee_services`) continue to use `ignoreDuplicates()`.

3. **Fallback Behavior**: If upsert fails for any reason, the endpoint will fetch and return the existing record instead of throwing an error.

---

## ✅ Status

**Fix Applied**: ✅ **COMPLETE**  
**File Modified**: `server/src/routes/query.ts`  
**Impact**: Users and Tenants table insert operations now handle duplicate keys gracefully

---

**Fix Date**: 2025-01-XX  
**Issue**: Duplicate key error on users table insert  
**Solution**: Upsert with fallback to return existing record
