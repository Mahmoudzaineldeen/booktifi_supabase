# Booking Customer ID Foreign Key Violation - Fixed

## ✅ Issue Fixed

The booking creation was failing with foreign key constraint violation:
```
insert or update on table "bookings" violates foreign key constraint "bookings_customer_id_fkey"
```

This has been permanently fixed by properly validating customer IDs before use.

## 🔧 Root Cause

The issue was that `req.user?.id` (a user ID from the `users` table) was being used as `customerIdForPackage`, but the foreign key constraint `bookings_customer_id_fkey` references `customers(id)`, not `users(id)`.

**Two different tables:**
- `users` table → Contains system users (receptionists, admins, etc.)
- `customers` table → Contains customer records (for bookings)

**The foreign key:**
- `bookings.customer_id` → References `customers(id)`, NOT `users(id)`

## 🔧 Changes Made

### File: `server/src/routes/bookings.ts`

**Fixed customer ID lookup logic:**

1. **Removed incorrect use of `req.user.id`:**
   - ❌ Before: `let customerIdForPackage = req.user?.id || req.body.customer_id;`
   - ✅ After: `let customerIdForPackage: string | null = req.body.customer_id || null;`

2. **Added customer lookup by phone:**
   - If no `customer_id` provided, looks up customer by phone number
   - Only uses customer ID if found in `customers` table

3. **Added customer validation:**
   - Validates that `customer_id` exists in `customers` table before using it
   - Sets to `NULL` if customer doesn't exist (avoids foreign key violation)
   - Logs warnings when invalid customer IDs are detected

4. **Clear separation:**
   - `p_session_id` = `req.user?.id` (for `created_by_user_id` - users table) ✅
   - `p_customer_id` = validated customer ID (for `customer_id` - customers table) ✅

## 📋 How It Works Now

### Customer ID Resolution Flow:

1. **Check if `customer_id` provided in request:**
   - If yes → Use it (but validate it exists)
   - If no → Continue to step 2

2. **Look up customer by phone number:**
   - Search `customers` table by phone and tenant_id
   - If found → Use customer ID
   - If not found → Set to NULL

3. **Validate customer exists:**
   - Check if customer_id exists in `customers` table
   - If exists → Use it ✅
   - If doesn't exist → Set to NULL (guest booking) ✅

4. **Pass to RPC function:**
   - `p_customer_id` = validated customer ID or NULL
   - `p_session_id` = user ID (for created_by_user_id)

## 🔍 What Changed

### Before (Broken):
```typescript
let customerIdForPackage = req.user?.id || req.body.customer_id;
// Problem: req.user.id is from users table, not customers table!
```

### After (Fixed):
```typescript
let customerIdForPackage: string | null = req.body.customer_id || null;

// Look up by phone if needed
if (!customerIdForPackage && normalizedPhone) {
  // Find customer in customers table
}

// Validate customer exists
if (customerIdForPackage) {
  // Verify it exists in customers table
  // Set to NULL if it doesn't exist
}
```

## ✅ Benefits

1. **No more foreign key violations** → Customer ID is always valid or NULL
2. **Guest bookings work** → NULL customer_id is allowed (foreign key is nullable)
3. **Package detection works** → Only checks packages if valid customer exists
4. **Clear error messages** → Logs show what went wrong
5. **Data integrity** → Only valid customer IDs are used

## 🚀 Testing

After this fix:

1. **Booking with existing customer** → Should work ✅
2. **Booking with new phone number** → Creates guest booking (customer_id = NULL) ✅
3. **Booking with invalid customer_id** → Sets to NULL, creates guest booking ✅
4. **Package detection** → Only runs if valid customer exists ✅

## 📝 Important Notes

### Guest Bookings

- If no customer is found, `customer_id` is set to `NULL`
- This is a **guest booking** (allowed by the schema)
- Package detection is skipped (no customer = no packages)
- Booking still works normally

### User ID vs Customer ID

- **User ID** (`req.user.id`) → Used for `created_by_user_id` (who created the booking)
- **Customer ID** → Used for `customer_id` (who the booking is for)
- These are **different** and come from **different tables**

## 🔗 Related Files

- `server/src/routes/bookings.ts` - Booking creation endpoint
- `supabase/migrations/20260131000008_fix_bookings_customer_id_fkey.sql` - Foreign key constraint
- `supabase/migrations/20260131000007_fix_payment_status_cast.sql` - RPC function
