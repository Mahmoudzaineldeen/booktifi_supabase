# Next Steps After Package Capacity System Migration

## ✅ Completed
- [x] Database migrations applied
- [x] Backend API endpoints created
- [x] Package capacity resolution function created
- [x] Service Provider Package Subscribers page created

## 🔧 Required Actions

### 1. Update Database Functions (CRITICAL)

The migration `20260130000002_update_bulk_booking_for_packages.sql` was a placeholder. You need to apply the updated function manually:

**Option A: Run the SQL file directly**
```bash
# Connect to your database and run:
psql -d your_database -f database/create_bulk_booking_function.sql
```

**Option B: Copy the function from `database/create_bulk_booking_function.sql`**
The file already has the `p_package_subscription_id` parameter added. Just execute it in your database.

### 2. Verify Function Signatures

Make sure both functions are updated:
- `create_booking_with_lock` - Should have `p_package_subscription_id` parameter (migration 20260130000001 should have done this)
- `create_bulk_booking` - Should have `p_package_subscription_id` parameter (needs manual update)

You can verify by running:
```sql
SELECT proname, pg_get_function_arguments(oid) 
FROM pg_proc 
WHERE proname IN ('create_booking_with_lock', 'create_bulk_booking');
```

### 3. Update Frontend Booking Flows (IMPORTANT)

The backend now automatically checks package capacity, but the frontend needs to pass `customer_id` when available:

**Files to update:**
- `src/pages/public/CheckoutPage.tsx` - Already passes customer info, but verify `customer_id` is included
- `src/pages/public/PublicBookingPage.tsx` - Needs to pass `customer_id` if user is logged in
- `src/pages/reception/ReceptionPage.tsx` - Already handles packages, but verify it works with new system

**What to add:**
When creating bookings, include `customer_id` in the request body:
```typescript
{
  // ... other fields
  customer_id: userProfile?.id || customerData?.id || null, // Add this
}
```

The backend will automatically:
- Look up customer by phone if `customer_id` not provided
- Check package capacity
- Apply package if capacity exists
- Set price to 0 if using package

### 4. Test the System

#### Test Scenarios:

**A. Customer with Package Capacity**
1. Create a package with services
2. Subscribe a customer to the package
3. Create a booking for that customer
4. ✅ Verify: Booking price should be 0, package capacity should decrease

**B. Customer without Package Capacity**
1. Create a booking for a customer without packages
2. ✅ Verify: Booking should be paid (normal price)

**C. Package Exhaustion**
1. Use all package capacity
2. Create another booking
3. ✅ Verify: Booking should be paid (capacity exhausted)

**D. Receptionist Booking**
1. Receptionist creates booking for customer with package
2. ✅ Verify: Package is automatically applied

**E. Bulk Booking with Package**
1. Create bulk booking for customer with package
2. ✅ Verify: All bookings use package if capacity sufficient

**F. Service Provider View**
1. Navigate to `/admin/package-subscribers`
2. ✅ Verify: Can see all subscribers and remaining capacity

### 5. Verify Package Subscribers Page

1. Navigate to: `/{tenantSlug}/admin/package-subscribers`
2. Should see:
   - List of active package subscriptions
   - Customer information
   - Remaining capacity per service
   - Search functionality

### 6. Check Backend Logs

When creating bookings, check server logs for:
```
[Booking Creation] ✅ Using package subscription: {id}
[Booking Creation]    Package: YES, Price: 0
```

## 🐛 Troubleshooting

### Issue: Package not being applied
**Check:**
- Is `customer_id` being passed in booking request?
- Does customer have active package subscription?
- Does package include the service being booked?
- Check backend logs for capacity resolution

### Issue: Function signature mismatch
**Fix:**
- Run the updated function SQL files
- Verify function parameters match what backend expects

### Issue: Package capacity not decreasing
**Check:**
- Is `package_subscription_id` being set in booking?
- Is the trigger `decrement_package_usage_on_booking` active?
- Check `package_subscription_usage` table

## 📝 Notes

- Packages no longer expire by time - they end only when capacity is consumed
- No partial package usage - if capacity is insufficient, entire booking becomes paid
- Package capacity is checked automatically - no manual selection needed
- All bookings (customer, receptionist, bulk) use the same logic

## 🎯 Success Criteria

System is working correctly when:
- ✅ Bookings automatically use package if capacity exists
- ✅ Package capacity decreases correctly
- ✅ Bookings become paid when capacity exhausted
- ✅ Service provider can view all subscribers
- ✅ No hardcoded package logic in frontend
- ✅ All booking flows work identically
