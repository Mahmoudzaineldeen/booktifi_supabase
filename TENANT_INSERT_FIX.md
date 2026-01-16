# Tenant Insert Fix - Duplicate Slug Issue

## Problem
When creating a tenant during signup, if the generated slug already exists, the insert fails with:
```
Duplicate entry: duplicate key value violates unique constraint "tenants_slug_key"
```

This blocks users from signing up if their business name generates a slug that already exists.

## Root Cause
1. Frontend generates slug from business name: `businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-')`
2. Database has unique constraint on `slug` column
3. If slug already exists, insert fails
4. No retry logic or unique slug generation

## Solution Implemented

### Updated Signup Page
**File**: `src/pages/auth/SignupPage.tsx`

**Changes**:
1. **Slug uniqueness check**: Before inserting, check if slug exists
2. **Auto-increment suffix**: If slug exists, try `slug-1`, `slug-2`, etc.
3. **Better error messages**: Specific error for duplicate slug
4. **Retry logic**: Up to 100 attempts to find unique slug

**Code**:
```typescript
// Generate base slug
let baseSlug = businessName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .substring(0, 50);

// Check if slug exists and generate unique one
let slug = baseSlug;
let slugCounter = 1;
let slugExists = true;

while (slugExists && slugCounter < 100) {
  const { data: existingTenant } = await db
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  
  if (!existingTenant) {
    slugExists = false;
  } else {
    slug = `${baseSlug}-${slugCounter}`;
    slugCounter++;
  }
}
```

### Enhanced Error Handling
**File**: `server/src/routes/query.ts`

**Changes**:
1. Better error logging with full details
2. Specific error messages for:
   - Duplicate slug (23505)
   - Missing required fields (23502)
   - Foreign key violations (23503)
   - RLS violations (42501)

## How It Works Now

1. **User enters business name**: e.g., "Test Business"
2. **Generate base slug**: "test-business"
3. **Check if exists**: Query database for slug
4. **If exists**: Try "test-business-1", "test-business-2", etc.
5. **Insert with unique slug**: Use the first available slug
6. **Success**: Tenant created with unique slug

## Testing

Test with duplicate business names:
1. Sign up with business name: "Test Business" → Creates slug: "test-business"
2. Sign up with business name: "Test Business" → Creates slug: "test-business-1"
3. Sign up with business name: "Test Business" → Creates slug: "test-business-2"

## Status

✅ **Fixed**: Signup page now handles duplicate slugs automatically
✅ **Error Handling**: Better error messages for users
✅ **Backend Logging**: Detailed error logs for debugging

## Next Steps

If signup still fails:
1. Check server terminal for detailed error logs
2. Verify required fields are being sent:
   - `name` (required)
   - `name_ar` (required)
   - `industry` (required)
   - `slug` (auto-generated, unique)
3. Check RLS policies if using ANON key
4. Verify database triggers exist:
   - `generate_tenant_slug()` function
   - `set_tenant_slug` trigger
   - `create_tenant_features_trigger` trigger
