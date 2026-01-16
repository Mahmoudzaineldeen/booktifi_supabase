# Comprehensive Testing Scenarios for Booking System

## Overview
This document outlines comprehensive testing scenarios to validate the entire booking system, including services, offers, packages, bookings, and their integrations.

---

## Test Environment Setup

### Prerequisites
1. **Database**: Ensure all migrations are applied
2. **Test Accounts**:
   - Service Provider: `zain@gmail.com` / `1111`
   - Customer Account: Create via signup or use existing
3. **Test Data**: Run setup scripts to create test services, offers, and packages

### Test Data Setup Scripts
```bash
# Create test services and packages
node scripts/setup_test_packages_complete.js

# Create test offers
node scripts/create_offers_for_services.js
```

---

## Scenario 1: Service Provider - Service Management

### 1.1 Create a New Service
**Steps:**
1. Login as service provider (`zain@gmail.com` / `1111`)
2. Navigate to Services page
3. Click "Add Service"
4. Fill in:
   - Name (EN): "Desert Safari Adventure"
   - Name (AR): "مغامرة رحلة الصحراء"
   - Description (EN): "Experience the beauty of the desert"
   - Description (AR): "اختبر جمال الصحراء"
   - Base Price: 200 SAR
   - Duration: 180 minutes
   - Category: Select or create category
   - Upload main image
   - Upload gallery images (3-5 images)
5. Click "Save"

**Expected Results:**
- ✅ Service is created successfully
- ✅ Service appears in services list
- ✅ Images are uploaded and displayed correctly
- ✅ Service is visible on public booking page
- ✅ No duplicate service created (name validation works)

**Edge Cases:**
- Try creating service with duplicate name (should fail)
- Try creating service without required fields (should show validation)
- Try uploading invalid image format (should show error)
- Try uploading very large image (should compress or show error)

---

### 1.2 Edit an Existing Service
**Steps:**
1. Navigate to Services page
2. Click "Edit" on an existing service
3. Modify:
   - Change price to 250 SAR
   - Update description
   - Add more gallery images
4. Click "Save"

**Expected Results:**
- ✅ Changes are saved successfully
- ✅ Updated information appears on public page
- ✅ Existing bookings are not affected

---

### 1.3 Delete a Service
**Steps:**
1. Navigate to Services page
2. Click "Delete" on a service that has:
   - Associated packages
   - Existing bookings
3. Confirm deletion

**Expected Results:**
- ✅ Warning message shows affected packages
- ✅ All associated packages are deleted
- ✅ Service is deleted successfully
- ✅ Related bookings remain (with service reference)

**Edge Cases:**
- Delete service with active bookings
- Delete service that is part of multiple packages

---

### 1.4 Search Services
**Steps:**
1. Navigate to Services page
2. Enter search query in search bar:
   - Search by English name
   - Search by Arabic name
   - Search by description
3. Clear search

**Expected Results:**
- ✅ Search filters services correctly
- ✅ Search works in both languages
- ✅ "No results found" shows when appropriate
- ✅ Clear search resets the list

---

## Scenario 2: Service Provider - Offers Management

### 2.1 Create Offers for a Service
**Steps:**
1. Navigate to Offers page
2. Click "Create Offer"
3. Select a service from dropdown
4. Verify auto-filled fields:
   - Duration (from service)
   - Original Price (from service)
   - Price (from service)
5. Fill in:
   - Name (EN): "Standard Package"
   - Name (AR): "الباقة القياسية"
   - Description: "Basic experience"
   - Price: 180 SAR (discounted from 200)
   - Original Price: 200 SAR
   - Discount Percentage: 10%
   - Badge: "Best Value"
   - Badge (AR): "أفضل قيمة"
   - Add 3 perks (EN)
   - Add 3 perks (AR)
6. Click "Save"

**Expected Results:**
- ✅ Offer is created successfully
- ✅ Auto-filled fields are correct
- ✅ Offer appears in offers list
- ✅ Offer is visible on service booking page
- ✅ Discount calculation is correct

**Edge Cases:**
- Create offer without selecting service (should show error)
- Create offer with price higher than original (should allow)
- Create offer with invalid discount percentage

---

### 2.2 Create Multiple Offers for Same Service
**Steps:**
1. Create first offer: "Standard Package" (10% discount)
2. Create second offer: "Premium Package" (20% discount)
3. Create third offer: "VIP Package" (30% discount)

**Expected Results:**
- ✅ All offers are created successfully
- ✅ All offers appear on service booking page
- ✅ Offers are ordered by creation date (newest first)
- ✅ Customer can select any offer

---

### 2.3 Edit an Offer
**Steps:**
1. Navigate to Offers page
2. Click "Edit" on an existing offer
3. Modify:
   - Change price
   - Update perks
   - Change badge
4. Click "Save"

**Expected Results:**
- ✅ Offer is updated successfully
- ✅ Changes reflect on booking page
- ✅ No "Failed to save offer" error
- ✅ JSON fields (perks) are saved correctly

**Edge Cases:**
- Edit offer with special characters in perks
- Edit offer with empty perks array
- Edit offer and change service (should work)

---

### 2.4 Delete an Offer
**Steps:**
1. Navigate to Offers page
2. Click "Delete" on an offer
3. Confirm deletion

**Expected Results:**
- ✅ Offer is deleted successfully
- ✅ Offer no longer appears on booking page
- ✅ Existing bookings with this offer remain valid

---

### 2.5 Search and Filter Offers
**Steps:**
1. Navigate to Offers page
2. Filter by service (dropdown)
3. Search by offer name
4. Search by description

**Expected Results:**
- ✅ Filter by service works correctly
- ✅ Search works in both languages
- ✅ Combined filter + search works
- ✅ "No results found" shows appropriately

---

## Scenario 3: Service Provider - Packages Management

### 3.1 Create a Package
**Steps:**
1. Navigate to Packages page
2. Click "Add Package"
3. Fill in:
   - Name (EN): "Complete Dubai Experience"
   - Name (AR): "تجربة دبي الكاملة"
   - Description: "Visit multiple attractions"
4. Select Services:
   - Select Service 1: "Burj Khalifa" (150 SAR)
   - Select Service 2: "Dubai Aquarium" (100 SAR)
   - Select Service 3: "Desert Safari" (200 SAR)
5. Verify auto-calculated fields:
   - Original Price: 450 SAR (150 + 100 + 200)
   - Total Price: Auto-filled as 450 SAR
6. Set discount:
   - Total Price: 360 SAR (20% discount)
   - Verify Discount Percentage: 20%
7. Upload package images
8. Click "Save"

**Expected Results:**
- ✅ Package is created successfully
- ✅ Original price = sum of all services
- ✅ Discount percentage is calculated correctly
- ✅ Package appears in packages list
- ✅ Package name format: "Combo (Save 20%): Burj Khalifa + Dubai Aquarium + Desert Safari"
- ✅ Package is visible on public booking page

**Edge Cases:**
- Try creating package with only 1 service (should show error)
- Try creating package with 0 services (should show error)
- Try setting total price higher than original (should allow)
- Try creating package with duplicate services

---

### 3.2 Edit a Package
**Steps:**
1. Navigate to Packages page
2. Click "Edit" on a package
3. Add another service
4. Verify auto-recalculation:
   - Original price updates
   - Discount percentage recalculates
5. Remove a service
6. Verify auto-recalculation again
7. Save changes

**Expected Results:**
- ✅ Package edits successfully
- ✅ Auto-calculation works correctly
- ✅ All services are displayed
- ✅ No white page error
- ✅ Images are preserved

**Edge Cases:**
- Edit package and remove all services (should prevent)
- Edit package and add duplicate service (should prevent or allow)
- Edit package with invalid price values

---

### 3.3 Delete a Package
**Steps:**
1. Navigate to Packages page
2. Click "Delete" on a package
3. Confirm deletion

**Expected Results:**
- ✅ Package is deleted successfully
- ✅ Package no longer appears on booking page
- ✅ Related records are cleaned up

---

### 3.4 Search Packages
**Steps:**
1. Navigate to Packages page
2. Enter search query
3. Verify results

**Expected Results:**
- ✅ Search filters packages correctly
- ✅ Search works in both languages
- ✅ "No results found" shows appropriately

---

## Scenario 4: Customer - Public Booking Flow

### 4.1 Browse Services
**Steps:**
1. Navigate to public booking page (`/:tenantSlug/book`)
2. Browse "Our Services" section
3. Verify:
   - Services are displayed with images
   - Service names in correct language
   - Prices are shown
   - "Check availability" buttons work

**Expected Results:**
- ✅ All active services are displayed
- ✅ Services are properly formatted
- ✅ Images load correctly
- ✅ Language toggle works

---

### 4.2 Browse Packages
**Steps:**
1. Navigate to public booking page
2. Browse "Our Packages" section
3. Verify:
   - Packages are displayed with correct format
   - Package names show: "Combo (Save X%): Service1 + Service2 + ..."
   - Original price (struck through) and final price shown
   - Save percentage displayed

**Expected Results:**
- ✅ All active packages are displayed
- ✅ Package names follow correct format
- ✅ Discount information is clear
- ✅ Clicking package navigates to schedule page

---

### 4.3 Book a Service with Offer
**Steps:**
1. Click "Check availability" on a service
2. Navigate to service booking page
3. View available offers:
   - Base service option
   - Standard Package offer
   - Premium Package offer
4. Select an offer:
   - Verify badge displays correctly (not covering price)
   - Verify perks are shown
   - Verify price is correct
5. Select date from calendar
6. Select time slot
7. Verify booking summary:
   - Selected offer name
   - Offer price (not base price)
   - Original price (if discounted)
   - Discount percentage
8. Click "Proceed to Checkout"

**Expected Results:**
- ✅ Offers are displayed correctly
- ✅ Badge doesn't cover price
- ✅ Selection works properly
- ✅ Booking summary shows correct offer price
- ✅ Price updates when offer is selected

**Edge Cases:**
- Select base service (no offer)
- Switch between offers
- Select offer with no discount
- Select offer with maximum discount

---

### 4.4 Book a Package
**Steps:**
1. Click on a package card
2. Navigate to package schedule page
3. Verify package information:
   - Package name and description
   - Included services list
   - Package price
   - Images
4. For each service in package:
   - Select date
   - Select time slot
5. Verify booking summary:
   - All services listed
   - Dates and times for each
   - Total package price
6. Click "Proceed to Checkout" when all services have dates/times

**Expected Results:**
- ✅ Package schedule page loads correctly
- ✅ All services in package are listed
- ✅ Date/time selection works for each service
- ✅ Continue button is disabled until all services selected
- ✅ Booking summary updates correctly

**Edge Cases:**
- Package with 2 services
- Package with 5+ services
- Some services have no available slots
- Different time zones

---

### 4.5 Checkout Process
**Steps:**
1. Complete service/package selection
2. Navigate to checkout page
3. Fill in customer information:
   - Name: "Ahmed Ali"
   - Phone: Select country code (+966)
   - Enter phone: 501234567
   - Email: "ahmed@example.com"
4. Verify phone validation:
   - Enter Egyptian number (1012345678) with Saudi code (+966)
   - Should show error
   - Change to Egyptian code (+20)
   - Should accept
5. Select visitor count
6. Review order summary:
   - Service/package details
   - Date and time
   - Price breakdown
   - Total price
7. Click "Complete Booking & Pay"

**Expected Results:**
- ✅ Phone validation works correctly
- ✅ Error messages are clear
- ✅ Country code + phone number validation
- ✅ Booking is created successfully
- ✅ Redirects to success page

**Edge Cases:**
- Invalid phone number format
- Phone number doesn't match country code
- Missing required fields
- Slot capacity exceeded

---

## Scenario 5: Phone Number Validation

### 5.1 Saudi Arabia Phone Validation
**Steps:**
1. Select country code: +966
2. Enter phone numbers:
   - Valid: 501234567 (9 digits, starts with 5)
   - Invalid: 101234567 (starts with 1 - Egyptian)
   - Invalid: 50123456 (8 digits - too short)
   - Invalid: 5012345678 (10 digits - too long)

**Expected Results:**
- ✅ Valid number is accepted
- ✅ Invalid numbers show appropriate errors
- ✅ Error messages are in correct language

---

### 5.2 Egypt Phone Validation
**Steps:**
1. Select country code: +20
2. Enter phone numbers:
   - Valid: 1012345678 (10 digits, starts with 1)
   - Invalid: 501234567 (Saudi number)
   - Invalid: 101234567 (9 digits - too short)

**Expected Results:**
- ✅ Valid number is accepted
- ✅ Invalid numbers show errors
- ✅ Error messages are clear

---

### 5.3 Other Countries
**Steps:**
1. Select various country codes
2. Enter phone numbers
3. Verify validation

**Expected Results:**
- ✅ Validation works for all supported countries
- ✅ Minimum/maximum length checks work
- ✅ Error messages are appropriate

---

## Scenario 6: Integration Testing

### 6.1 Service → Offers → Booking Flow
**Steps:**
1. Create a service
2. Create 2 offers for that service
3. Book the service with an offer
4. Verify booking shows correct offer
5. Check booking in admin dashboard

**Expected Results:**
- ✅ Complete flow works end-to-end
- ✅ Offer ID is saved in booking
- ✅ Booking shows correct offer details
- ✅ Price matches selected offer

---

### 6.2 Service → Package → Booking Flow
**Steps:**
1. Create 3 services
2. Create a package with those 3 services
3. Book the package
4. Verify all 3 services are booked
5. Check bookings in admin dashboard

**Expected Results:**
- ✅ Package booking creates bookings for all services
- ✅ All bookings are linked correctly
- ✅ Package price is applied correctly
- ✅ Schedule is inherited from services

---

### 6.3 Delete Service with Packages
**Steps:**
1. Create a service
2. Create a package including that service
3. Try to delete the service
4. Verify warning message
5. Confirm deletion

**Expected Results:**
- ✅ Warning shows affected packages
- ✅ Package is deleted when service is deleted
- ✅ Related records are cleaned up
- ✅ No orphaned data

---

### 6.4 Recommendation System
**Steps:**
1. As anonymous user, view multiple services
2. Book a service
3. Check "You May Also Like" section
4. Verify recommendations are relevant

**Expected Results:**
- ✅ Recommendations based on view history
- ✅ Recommendations based on booking history
- ✅ Recommendations consider category, price, ratings
- ✅ Top 4 services are shown

---

## Scenario 7: Error Handling and Edge Cases

### 7.1 Network Errors
**Steps:**
1. Disconnect internet
2. Try to create service
3. Try to book service
4. Reconnect internet
5. Verify error handling

**Expected Results:**
- ✅ Appropriate error messages
- ✅ No crashes
- ✅ Data is not lost
- ✅ Retry mechanisms work

---

### 7.2 Invalid Data
**Steps:**
1. Try to create service with:
   - Negative price
   - Zero duration
   - Invalid date
   - Very long text fields
2. Try to book with:
   - Past dates
   - Invalid time slots
   - Negative visitor count

**Expected Results:**
- ✅ Validation prevents invalid data
- ✅ Error messages are clear
- ✅ No database errors
- ✅ UI remains responsive

---

### 7.3 Concurrent Bookings
**Steps:**
1. Open booking page in 2 browser tabs
2. Select same slot in both tabs
3. Complete booking in first tab
4. Try to complete booking in second tab

**Expected Results:**
- ✅ Lock mechanism prevents double booking
- ✅ Second booking shows appropriate error
- ✅ Capacity is updated correctly
- ✅ No race conditions

---

## Scenario 8: Multi-language Testing

### 8.1 Arabic Interface
**Steps:**
1. Switch to Arabic language
2. Navigate through all pages
3. Verify:
   - All text is in Arabic
   - RTL layout works
   - Forms work correctly
   - Dates/times display correctly

**Expected Results:**
- ✅ Complete Arabic translation
- ✅ RTL layout is correct
- ✅ Forms function properly
- ✅ No mixed languages

---

### 8.2 Language Switching
**Steps:**
1. Start in English
2. Create a service in English
3. Switch to Arabic
4. Verify service shows Arabic name
5. Switch back to English

**Expected Results:**
- ✅ Language toggle works smoothly
- ✅ Data displays in correct language
- ✅ No data loss on switch
- ✅ Forms update correctly

---

## Scenario 9: Performance Testing

### 9.1 Large Data Sets
**Steps:**
1. Create 50+ services
2. Create 100+ offers
3. Create 20+ packages
4. Test page load times
5. Test search functionality

**Expected Results:**
- ✅ Pages load within acceptable time
- ✅ Search is responsive
- ✅ No memory leaks
- ✅ Smooth scrolling

---

### 9.2 Image Loading
**Steps:**
1. Upload large images
2. Verify compression
3. Check gallery loading
4. Test on slow connection

**Expected Results:**
- ✅ Images are compressed
- ✅ Loading states are shown
- ✅ Fallbacks for failed loads
- ✅ Performance is acceptable

---

## Scenario 10: Admin Dashboard Testing

### 10.1 View Bookings
**Steps:**
1. Login as service provider
2. Navigate to bookings/reception page
3. View all bookings
4. Filter by status
5. Search bookings

**Expected Results:**
- ✅ All bookings are displayed
- ✅ Filters work correctly
- ✅ Search works
- ✅ Booking details are accurate

---

### 10.2 Manage Bookings
**Steps:**
1. View a booking
2. Change status
3. Update payment status
4. Add notes
5. Check in customer

**Expected Results:**
- ✅ Status updates work
- ✅ Changes are saved
- ✅ History is tracked
- ✅ Notifications work (if implemented)

---

## Test Checklist Summary

### Service Provider Features
- [ ] Create, edit, delete services
- [ ] Upload and manage images
- [ ] Search services
- [ ] Prevent duplicate services
- [ ] Create, edit, delete offers
- [ ] Auto-fill offer fields from service
- [ ] Search and filter offers
- [ ] Create, edit, delete packages
- [ ] Auto-calculate package prices
- [ ] Search packages
- [ ] Delete service with packages

### Customer Features
- [ ] Browse services
- [ ] Browse packages
- [ ] View service details
- [ ] Select offers
- [ ] Book service with offer
- [ ] Book package
- [ ] Phone number validation
- [ ] Checkout process
- [ ] View booking confirmation

### Integration
- [ ] Service → Offers → Booking
- [ ] Service → Package → Booking
- [ ] Recommendation system
- [ ] Multi-language support
- [ ] Error handling
- [ ] Performance

---

## Test Execution Log

### Date: _______________
### Tester: _______________

| Scenario | Status | Notes |
|----------|--------|-------|
| 1.1 Create Service | ⬜ | |
| 1.2 Edit Service | ⬜ | |
| 1.3 Delete Service | ⬜ | |
| 1.4 Search Services | ⬜ | |
| 2.1 Create Offers | ⬜ | |
| 2.2 Multiple Offers | ⬜ | |
| 2.3 Edit Offer | ⬜ | |
| 2.4 Delete Offer | ⬜ | |
| 2.5 Search Offers | ⬜ | |
| 3.1 Create Package | ⬜ | |
| 3.2 Edit Package | ⬜ | |
| 3.3 Delete Package | ⬜ | |
| 3.4 Search Packages | ⬜ | |
| 4.1 Browse Services | ⬜ | |
| 4.2 Browse Packages | ⬜ | |
| 4.3 Book Service with Offer | ⬜ | |
| 4.4 Book Package | ⬜ | |
| 4.5 Checkout | ⬜ | |
| 5.1-5.3 Phone Validation | ⬜ | |
| 6.1-6.4 Integration | ⬜ | |
| 7.1-7.3 Error Handling | ⬜ | |
| 8.1-8.2 Multi-language | ⬜ | |
| 9.1-9.2 Performance | ⬜ | |
| 10.1-10.2 Admin Dashboard | ⬜ | |

---

## Known Issues and Notes

### Issues Found:
1. 
2. 
3. 

### Notes:
- 
- 
- 

---

## Next Steps After Testing

1. Fix any bugs found
2. Optimize performance issues
3. Improve error messages
4. Add missing validations
5. Enhance user experience based on findings



