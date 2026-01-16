# Testing Guide - Quick Start

## Overview
This guide helps you quickly set up and execute comprehensive tests for the booking system.

---

## Quick Setup

### 1. Prepare Test Environment

```bash
# Navigate to project directory
cd project

# Ensure database is running
# Ensure all migrations are applied

# Set environment variables (if needed)
export DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
export VITE_SUPABASE_URL="http://localhost:54321"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

### 2. Create Test Data

**Option A: Comprehensive Test Data (Recommended)**
```bash
node scripts/create_comprehensive_test_data.js
```

This creates:
- 10 services across different categories
- 3 offers for each service (30 total offers)
- 4 packages with various combinations
- Schedules for all services
- Images for services and packages

**Option B: Basic Test Data**
```bash
# Create basic services and packages
node scripts/setup_test_packages_complete.js

# Create offers for services
node scripts/create_offers_for_services.js
```

### 3. Test Accounts

**Service Provider:**
- Email: `zain@gmail.com`
- Password: `1111`

**Customer:**
- Create a new account via signup page
- Or use existing customer account

---

## Testing Workflow

### Phase 1: Service Provider Features (30-45 minutes)

1. **Service Management**
   - [ ] Create a new service
   - [ ] Edit an existing service
   - [ ] Delete a service (with packages)
   - [ ] Search services
   - [ ] Upload images

2. **Offers Management**
   - [ ] Create offers for a service
   - [ ] Verify auto-fill functionality
   - [ ] Edit an offer
   - [ ] Delete an offer
   - [ ] Search and filter offers

3. **Packages Management**
   - [ ] Create a package
   - [ ] Verify auto-calculation
   - [ ] Edit a package
   - [ ] Delete a package
   - [ ] Search packages

### Phase 2: Customer Booking Flow (20-30 minutes)

1. **Browse and Select**
   - [ ] Browse services
   - [ ] Browse packages
   - [ ] View service details
   - [ ] Select an offer

2. **Booking Process**
   - [ ] Book a service with offer
   - [ ] Book a package
   - [ ] Complete checkout
   - [ ] Verify booking confirmation

3. **Phone Validation**
   - [ ] Test Saudi phone numbers
   - [ ] Test Egyptian phone numbers
   - [ ] Test other countries
   - [ ] Verify error messages

### Phase 3: Integration Testing (15-20 minutes)

1. **End-to-End Flows**
   - [ ] Service → Offers → Booking
   - [ ] Service → Package → Booking
   - [ ] Delete service with packages
   - [ ] Recommendation system

2. **Error Handling**
   - [ ] Invalid data validation
   - [ ] Network errors
   - [ ] Concurrent bookings

### Phase 4: Multi-language & UI (10-15 minutes)

1. **Language Testing**
   - [ ] Switch to Arabic
   - [ ] Test all pages in Arabic
   - [ ] Verify RTL layout
   - [ ] Switch back to English

2. **UI/UX**
   - [ ] Responsive design
   - [ ] Image loading
   - [ ] Form validation
   - [ ] Error messages

---

## Test Execution Checklist

Use this checklist to track your testing progress:

### ✅ Service Provider Tests
- [ ] Create service
- [ ] Edit service
- [ ] Delete service
- [ ] Search services
- [ ] Create offer
- [ ] Edit offer
- [ ] Delete offer
- [ ] Search offers
- [ ] Create package
- [ ] Edit package
- [ ] Delete package
- [ ] Search packages

### ✅ Customer Tests
- [ ] Browse services
- [ ] Browse packages
- [ ] Select offer
- [ ] Book service
- [ ] Book package
- [ ] Phone validation
- [ ] Checkout process

### ✅ Integration Tests
- [ ] Service → Offer → Booking
- [ ] Service → Package → Booking
- [ ] Delete service with packages
- [ ] Recommendation system

### ✅ Error Handling
- [ ] Invalid data
- [ ] Network errors
- [ ] Concurrent bookings

### ✅ Multi-language
- [ ] Arabic interface
- [ ] Language switching
- [ ] RTL layout

---

## Common Issues and Solutions

### Issue: "Package not found"
**Solution:**
- Check RLS policies are applied
- Verify package is active
- Check tenant_id matches

### Issue: "Failed to save offer"
**Solution:**
- Check JSON fields (perks) are properly formatted
- Verify all required fields are filled
- Check database connection

### Issue: "Phone validation not working"
**Solution:**
- Verify country code is selected
- Check phone number format matches country
- Clear browser cache

### Issue: "Auto-calculation not working"
**Solution:**
- Refresh the page
- Check services are selected
- Verify base_price is set for services

---

## Test Data Cleanup

If you need to start fresh:

```sql
-- Delete all test data (use with caution!)
DELETE FROM package_services;
DELETE FROM service_packages;
DELETE FROM service_offers;
DELETE FROM bookings WHERE customer_email LIKE '%test%';
DELETE FROM services WHERE name LIKE '%Test%';
```

Or use the cleanup script:
```bash
node scripts/cleanup_test_data.js  # If created
```

---

## Reporting Issues

When reporting issues, include:

1. **Scenario**: Which test scenario failed
2. **Steps**: Exact steps to reproduce
3. **Expected**: What should happen
4. **Actual**: What actually happened
5. **Screenshots**: If applicable
6. **Console Errors**: Browser console errors
7. **Network Errors**: Network tab errors

---

## Next Steps

After completing all tests:

1. Document any bugs found
2. Prioritize fixes
3. Re-test after fixes
4. Update test scenarios if needed
5. Create regression tests for critical paths

---

## Support

For questions or issues:
- Check `TESTING_SCENARIOS.md` for detailed scenarios
- Review code comments
- Check database migrations
- Verify environment setup



