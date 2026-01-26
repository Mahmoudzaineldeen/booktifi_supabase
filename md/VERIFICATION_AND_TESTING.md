# Package Capacity System - Verification & Testing Guide

## ✅ What's Been Completed

1. **Database Migrations** - All applied successfully
   - ✅ `20260130000000_redesign_package_capacity_system.sql`
   - ✅ `20260130000001_update_booking_function_for_packages.sql`
   - ✅ `20260130000002_update_bulk_booking_for_packages.sql`
   - ✅ `20260130000003_migrate_existing_packages.sql`

2. **Backend Implementation**
   - ✅ `resolveCustomerServiceCapacity()` function created
   - ✅ Package capacity checking integrated into booking creation
   - ✅ Automatic package application when capacity exists
   - ✅ API endpoints for capacity resolution

3. **Frontend Implementation**
   - ✅ Package Subscribers page created
   - ✅ Routes and navigation added

## 🔍 Verification Steps

### Step 1: Verify Database Functions

Run this SQL to verify both functions have the correct signatures:

```sql
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments,
  array_length(proargtypes::regtype[], 1) as param_count
FROM pg_proc
WHERE proname IN ('create_booking_with_lock', 'create_bulk_booking')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname, param_count;
```

**Expected Results:**
- `create_booking_with_lock` should have 18 parameters (including `p_package_subscription_id`)
- `create_bulk_booking` should have 18 parameters (including `p_package_subscription_id`)

### Step 2: Verify Package Capacity Function

Test the capacity resolution function:

```sql
-- Replace with actual customer_id and service_id from your database
SELECT * FROM resolveCustomerServiceCapacity(
  'your-customer-id-here'::uuid,
  'your-service-id-here'::uuid
);
```

**Expected Result:**
- Returns `total_remaining_capacity`, `source_package_ids[]`, and `exhaustion_status[]`

### Step 3: Test Package Subscribers Page

1. Navigate to: `/{tenantSlug}/admin/package-subscribers`
2. Should display:
   - List of active package subscriptions
   - Customer information
   - Remaining capacity per service
   - Search functionality

## 🧪 Testing Scenarios

### Test 1: Customer Booking with Package

**Setup:**
1. Create a package with 2 services (Service A: 5 capacity, Service B: 3 capacity)
2. Subscribe a customer to this package
3. Ensure customer has `customer_id` in database

**Test:**
1. Customer books Service A (1 visitor)
2. **Expected:** 
   - Booking price = 0
   - Package capacity for Service A decreases from 5 to 4
   - Check backend logs: `[Booking Creation] ✅ Using package subscription: {id}`

**Verify:**
```sql
SELECT remaining_quantity, used_quantity 
FROM package_subscription_usage 
WHERE subscription_id = 'your-subscription-id' 
  AND service_id = 'service-a-id';
```

### Test 2: Customer Booking without Package

**Test:**
1. Customer without package books a service
2. **Expected:**
   - Booking price = normal service price
   - No package_subscription_id set
   - Booking is paid

### Test 3: Package Exhaustion

**Test:**
1. Use all capacity for a service (book until remaining = 0)
2. Create another booking for the same service
3. **Expected:**
   - Booking price = normal service price (paid)
   - Package capacity exhausted notification recorded
   - Check `package_exhaustion_notifications` table

### Test 4: Receptionist Booking

**Test:**
1. Receptionist creates booking for customer with package
2. **Expected:**
   - Package automatically applied
   - Booking price = 0
   - Capacity decreases

**Note:** Backend automatically looks up customer by phone if `customer_id` not provided.

### Test 5: Bulk Booking with Package

**Test:**
1. Customer with package (5 capacity remaining) creates bulk booking (3 visitors)
2. **Expected:**
   - All 3 bookings use package
   - All bookings have price = 0
   - Capacity decreases from 5 to 2

### Test 6: Partial Capacity (No Partial Usage)

**Test:**
1. Customer has 2 capacity remaining
2. Creates booking for 3 visitors
3. **Expected:**
   - Entire booking becomes paid (no partial usage)
   - Capacity remains at 2 (not consumed)

## 🔧 Optional Frontend Improvements

The backend automatically looks up customers by phone, but you can improve it by passing `customer_id` when available:

### Update CheckoutPage.tsx

Add `customer_id` to the booking request:

```typescript
body: JSON.stringify({
  // ... existing fields
  customer_id: userProfile?.id || null, // Add this line
}),
```

### Update ReceptionPage.tsx

The receptionist page should look up customer and pass `customer_id`:

```typescript
// After looking up customer by phone, include customer_id
body: JSON.stringify({
  // ... existing fields
  customer_id: customerData?.id || null, // Add this if customer found
}),
```

## 📊 Monitoring & Debugging

### Check Backend Logs

When creating bookings, look for:
```
[Booking Creation] ✅ Using package subscription: {id}
[Booking Creation]    Package: YES, Price: 0
```

Or if no package:
```
[Booking Creation] ⚠️ Package capacity check failed: {error}
[Booking Creation]    Package: NO, Price: {normal_price}
```

### Database Queries for Debugging

**Check package subscriptions:**
```sql
SELECT ps.*, c.name as customer_name, sp.name as package_name
FROM package_subscriptions ps
JOIN customers c ON ps.customer_id = c.id
JOIN service_packages sp ON ps.package_id = sp.id
WHERE ps.status = 'active' AND ps.is_active = true;
```

**Check package usage:**
```sql
SELECT psu.*, s.name as service_name
FROM package_subscription_usage psu
JOIN services s ON psu.service_id = s.id
WHERE psu.subscription_id = 'your-subscription-id';
```

**Check bookings using packages:**
```sql
SELECT b.id, b.customer_name, b.total_price, b.package_subscription_id, s.name as service_name
FROM bookings b
JOIN services s ON b.service_id = s.id
WHERE b.package_subscription_id IS NOT NULL
ORDER BY b.created_at DESC
LIMIT 10;
```

## ✅ Success Checklist

- [ ] Both database functions have 18 parameters
- [ ] `resolveCustomerServiceCapacity` function works
- [ ] Package Subscribers page loads and displays data
- [ ] Customer booking with package → price = 0
- [ ] Customer booking without package → normal price
- [ ] Package capacity decreases correctly
- [ ] Receptionist booking applies package automatically
- [ ] Bulk booking works with packages
- [ ] No partial package usage (insufficient capacity → paid booking)
- [ ] Exhaustion notifications recorded

## 🚀 You're Ready!

The system is fully implemented. Start testing with the scenarios above. The backend automatically handles package capacity checking, so bookings will use packages when available without any frontend changes needed.
