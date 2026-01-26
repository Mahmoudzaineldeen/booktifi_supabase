# Package Exceed and Exhaustion Test Guide

## Overview

This test suite verifies two critical scenarios to ensure invoice creation works correctly:

1. **Booking Exceeds Package Capacity** → Remaining quantity creates invoice
2. **Package Fully Consumed** → New bookings create invoices correctly (no errors)

## Test Scenarios

### Test 1: Booking Exceeds Package Capacity

**Scenario:**
- Package has **5 remaining** tickets
- Customer books **8 tickets**
- Expected behavior:
  - 5 tickets covered by package (free)
  - 3 tickets paid (invoice created)
  - Invoice amount = 3 × service_price

**What it tests:**
- ✅ Partial coverage calculation is correct
- ✅ `package_covered_quantity = 5`
- ✅ `paid_quantity = 3`
- ✅ `total_price = 3 × service_price`
- ✅ Package usage updated correctly (0 remaining, 5 used)
- ✅ Invoice can be created for the paid portion

### Test 2: Package Fully Consumed → New Booking

**Scenario:**
- Package is **fully exhausted** (0 remaining, 5 used)
- Customer books **3 tickets**
- Expected behavior:
  - 0 tickets covered by package (none available)
  - 3 tickets paid (full invoice)
  - Invoice amount = 3 × service_price
  - No errors when creating booking/invoice

**What it tests:**
- ✅ Booking created successfully even when package is exhausted
- ✅ `package_covered_quantity = 0`
- ✅ `paid_quantity = 3` (all paid)
- ✅ `total_price = 3 × service_price`
- ✅ `package_subscription_id = null` (no package used)
- ✅ Package usage remains exhausted (doesn't go negative)
- ✅ Invoice can be created without errors

## Running the Tests

### Prerequisites

1. **Environment Variables:**
   ```bash
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

2. **Database Setup:**
   - At least one tenant exists
   - Services table has at least one service
   - Slots can be created (or exist)

### Run Tests

```bash
node tests/test-package-exceed-and-exhaustion.js
```

### Expected Output

```
🧪 PACKAGE EXCEED AND EXHAUSTION TEST SUITE
==========================================

📋 Step 1: Getting tenant...
✅ Using tenant: xxx

📋 Step 2: Getting or creating service...
✅ Using service: xxx, Price: 100

📋 Step 3: Getting or creating package...
✅ Using package: xxx

📋 Step 4: Getting or creating customer...
✅ Using customer: xxx

📋 Step 5: Creating package subscription...
✅ Using subscription: xxx

📋 Step 6: Getting or creating slot...
✅ Using slot: xxx

🧪 TEST 1: Booking Exceeds Package Capacity → Invoice for Remaining
=====================================================================
📋 Setup: Package has 5 remaining, booking 8 tickets...
✅ Initial state: 5 remaining, 0 used
📋 Creating booking: 8 tickets
   Expected: 5 covered, 3 paid, price: 300
✅ Booking created: xxx
📊 Booking data: { ... }
✅ PASS: TEST 1 - Package covered quantity = 5
✅ PASS: TEST 1 - Paid quantity = 3
✅ PASS: TEST 1 - Total price = 3 × service_price
✅ PASS: TEST 1 - Sum equals visitor_count
✅ PASS: TEST 1 - Package usage updated correctly (0 remaining, 5 used)

🧪 TEST 2: Package Fully Consumed → New Booking Creates Invoice
==================================================================
📋 Setup: Package fully consumed (0 remaining)...
✅ Initial state: 0 remaining, 5 used (EXHAUSTED)
📋 Creating booking: 3 tickets (package exhausted)
   Expected: 0 covered, 3 paid, price: 300
✅ Booking created: xxx
📊 Booking data: { ... }
✅ PASS: TEST 2 - Package covered quantity = 0 (exhausted)
✅ PASS: TEST 2 - Paid quantity = 3 (all paid)
✅ PASS: TEST 2 - Total price = 3 × service_price
✅ PASS: TEST 2 - Sum equals visitor_count
✅ PASS: TEST 2 - No package subscription ID (exhausted)
✅ PASS: TEST 2 - Package usage remains exhausted (0 remaining, 5 used)

============================================================
📊 TEST SUMMARY
============================================================
✅ Passed: 10
❌ Failed: 0
⚠️  Warnings: 0
============================================================
```

## Test Coverage

### What Gets Tested

1. **Database Integrity:**
   - Package coverage values are correct
   - Paid quantity matches expected
   - Total price calculation is accurate
   - Package usage updates correctly

2. **Invoice Creation:**
   - Invoice can be created for partial coverage
   - Invoice can be created after package exhaustion
   - No errors when package is exhausted

3. **Edge Cases:**
   - Package capacity exceeded
   - Package fully consumed
   - No package subscription ID when exhausted

### What's NOT Tested (Manual Testing Required)

1. **Zoho Integration:**
   - Actual invoice creation in Zoho (requires Zoho configuration)
   - Invoice delivery via email/WhatsApp
   - Invoice status updates

2. **Frontend:**
   - UI display of package coverage
   - Badge rendering
   - Price display

## Troubleshooting

### Test Fails: "No tenant found"

**Solution:** Create a tenant in your database or update the test to use an existing tenant.

### Test Fails: "RPC Error"

**Solution:** 
1. Check that all migrations are applied
2. Verify `create_booking_with_lock` function exists
3. Check database permissions

### Test Fails: "Slot not found"

**Solution:** The test will create a slot automatically, but ensure:
- Shifts table has data or can be created
- Service exists and is active

### Invoice ID is null

**Note:** This is expected if Zoho is not configured. The test will pass but log a warning. To test actual invoice creation:
1. Configure Zoho in your tenant settings
2. Ensure Zoho tokens are valid
3. Re-run the test

## Cleanup

After running tests, you can clean up test data:

```sql
-- Delete test bookings
DELETE FROM bookings WHERE customer_name LIKE 'PKG_EXCEED_TEST%';

-- Delete test package subscription
DELETE FROM package_subscriptions WHERE id = '<subscription_id_from_test>';

-- Delete test customer
DELETE FROM customers WHERE id = '<customer_id_from_test>';
```

## Integration with CI/CD

To run these tests in CI/CD:

```yaml
# Example GitHub Actions
- name: Run Package Exceed Tests
  run: |
    node tests/test-package-exceed-and-exhaustion.js
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Related Tests

- `test-strict-package-billing.js` - Comprehensive strict billing tests
- `test-package-financial-behavior.js` - Package financial behavior tests
- `test-package-capacity-system.js` - Package capacity system tests

## Status

✅ **READY** - Tests are complete and ready to run.

These tests ensure that:
1. ✅ Partial coverage invoices are created correctly
2. ✅ Exhausted packages don't break invoice creation
3. ✅ Invoice amounts are correct for both scenarios
