# 🚀 Start Testing - Quick Reference

## Current Status
✅ Test data is ready (19 services with offers)  
✅ Test scenarios documented  
⏳ Ready to begin manual testing

---

## Step-by-Step Testing Guide

### Phase 1: Service Provider Testing (Start Here)

#### 1. Login as Service Provider
- **URL:** http://localhost:5173/tour/admin
- **Email:** zain@gmail.com
- **Password:** 1111

#### 2. Test Service Management
Navigate to: **Services** page

**Test 1.1: Create a New Service**
1. Click "Add Service"
2. Fill in:
   - Name (EN): "Test Service - [Your Name]"
   - Name (AR): "خدمة اختبار - [اسمك]"
   - Description: "This is a test service"
   - Base Price: 100 SAR
   - Duration: 60 minutes
   - Upload an image
3. Click "Save"
4. ✅ Verify: Service appears in list
5. ✅ Verify: No duplicate error if name exists

**Test 1.2: Edit a Service**
1. Click "Edit" on any service
2. Change price to 150 SAR
3. Update description
4. Click "Save"
5. ✅ Verify: Changes are saved
6. ✅ Verify: Updated info appears on public page

**Test 1.3: Search Services**
1. Type in search bar: "Burj"
2. ✅ Verify: Services filter correctly
3. Clear search
4. ✅ Verify: All services show again

**Test 1.4: Delete a Service**
1. Find a service that's NOT in any package
2. Click "Delete"
3. Confirm deletion
4. ✅ Verify: Service is removed
5. ⚠️ Note: If service is in a package, you'll see a warning

---

#### 3. Test Offers Management
Navigate to: **Offers** page

**Test 2.1: Create an Offer**
1. Click "Create Offer"
2. Select a service from dropdown
3. ✅ Verify: Duration and price auto-fill
4. Fill in:
   - Name: "Test Offer"
   - Price: 90 SAR (discounted from 100)
   - Badge: "Best Value"
   - Add 2-3 perks
5. Click "Save"
6. ✅ Verify: Offer appears in list
7. ✅ Verify: Offer shows on service booking page

**Test 2.2: Edit an Offer**
1. Click "Edit" on an offer
2. Change price to 85 SAR
3. Update perks
4. Click "Save"
5. ✅ Verify: No "Failed to save offer" error
6. ✅ Verify: Changes are saved

**Test 2.3: Search Offers**
1. Filter by service
2. Search by offer name
3. ✅ Verify: Search works correctly

---

#### 4. Test Packages Management
Navigate to: **Packages** page

**Test 3.1: Create a Package**
1. Click "Add Package"
2. Fill in name and description
3. Select 2-3 services
4. ✅ Verify: Original price = sum of services
5. Set total price lower (e.g., 20% discount)
6. ✅ Verify: Discount percentage calculates automatically
7. Upload package images
8. Click "Save"
9. ✅ Verify: Package name format: "Combo (Save X%): Service1 + Service2 + ..."
10. ✅ Verify: Package appears on public booking page

**Test 3.2: Edit a Package**
1. Click "Edit" on a package
2. Add another service
3. ✅ Verify: Original price updates automatically
4. ✅ Verify: Discount recalculates
5. Save changes
6. ✅ Verify: No white page error

**Test 3.3: Search Packages**
1. Type in search bar
2. ✅ Verify: Packages filter correctly

---

### Phase 2: Customer Booking Testing

#### 5. Test Public Booking Page
Navigate to: **http://localhost:5173/tour/book**

**Test 4.1: Browse Services**
1. ✅ Verify: "Our Services" section shows all services
2. ✅ Verify: Services have images
3. ✅ Verify: Prices are displayed
4. Click "Check availability" on a service

**Test 4.2: Browse Packages**
1. Scroll to "Our Packages" section
2. ✅ Verify: Packages show correct format
3. ✅ Verify: Save percentage is displayed
4. ✅ Verify: Original price (struck through) and final price shown
5. Click on a package

**Test 4.3: Book a Service with Offer**
1. On service booking page, view offers
2. ✅ Verify: Base service option is shown
3. ✅ Verify: All offers are displayed
4. ✅ Verify: Badge doesn't cover price
5. Select an offer
6. ✅ Verify: Booking summary shows offer price (not base price)
7. Select date and time
8. Click "Proceed to Checkout"

**Test 4.4: Book a Package**
1. On package schedule page
2. ✅ Verify: All services in package are listed
3. For each service:
   - Select date
   - Select time slot
4. ✅ Verify: "Continue" button disabled until all selected
5. ✅ Verify: Booking summary shows all services
6. Click "Proceed to Checkout"

**Test 4.5: Checkout with Phone Validation**
1. Fill in customer info:
   - Name: "Test Customer"
   - Phone: Select +966 (Saudi)
   - Enter: 501234567 ✅ Should accept
   - Try: 1012345678 ❌ Should show error (Egyptian number)
   - Change to +20 (Egypt)
   - Enter: 1012345678 ✅ Should accept
2. Select visitor count
3. Review order summary
4. Click "Complete Booking & Pay"
5. ✅ Verify: Booking is created
6. ✅ Verify: Redirects to success page

---

### Phase 3: Integration Testing

**Test 6.1: End-to-End Service Booking**
1. Create a service
2. Create 2 offers for it
3. Book the service with an offer
4. ✅ Verify: Booking shows correct offer
5. ✅ Verify: Price matches selected offer

**Test 6.2: End-to-End Package Booking**
1. Create a package with 3 services
2. Book the package
3. ✅ Verify: All 3 services are booked
4. ✅ Verify: Package price is applied

**Test 6.3: Delete Service with Packages**
1. Create a service
2. Create a package including that service
3. Try to delete the service
4. ✅ Verify: Warning shows affected packages
5. Confirm deletion
6. ✅ Verify: Package is also deleted

**Test 6.4: Recommendation System**
1. As anonymous user, view 3-4 different services
2. Book one service
3. Check "You May Also Like" section
4. ✅ Verify: Recommendations are relevant
5. ✅ Verify: Based on view/booking history

---

## Quick Checklist

### Service Provider
- [ ] Create service
- [ ] Edit service
- [ ] Search services
- [ ] Create offer (verify auto-fill)
- [ ] Edit offer (verify no errors)
- [ ] Search offers
- [ ] Create package (verify auto-calculation)
- [ ] Edit package (verify no white page)
- [ ] Search packages

### Customer
- [ ] Browse services
- [ ] Browse packages
- [ ] Select offer (verify badge doesn't cover price)
- [ ] Book service (verify price in summary)
- [ ] Book package
- [ ] Phone validation (Saudi +966)
- [ ] Phone validation (Egypt +20)
- [ ] Complete checkout

### Integration
- [ ] Service → Offer → Booking
- [ ] Service → Package → Booking
- [ ] Delete service with packages
- [ ] Recommendations work

---

## Common Issues to Watch For

1. **"Failed to save offer"** - Check JSON fields (perks)
2. **White page when editing package** - Check console for errors
3. **Badge covering price** - Should be fixed, verify
4. **Price not updating in summary** - Should be fixed, verify
5. **Phone validation not working** - Check country code match
6. **Package not found** - Check RLS policies

---

## Next Steps After Testing

1. Document all issues found
2. Prioritize fixes
3. Re-test after fixes
4. Update test scenarios if needed

---

**Ready to start?** Begin with Phase 1, Test 1.1! 🚀



