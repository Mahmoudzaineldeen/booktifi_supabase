# Packages Feature - Testing Guide

## Overview
This guide covers the complete packages feature implementation and testing requirements.

## ✅ Implementation Status

### Package Creation Flow (Service Provider Dashboard)
- ✅ Requires 2+ services selection
- ✅ Auto-calculates total price from selected services
- ✅ Total price field is locked (read-only)
- ✅ Discount mechanism (same as services)
  - Original price (auto-calculated, read-only)
  - Discount percentage (editable)
  - Final price (editable, auto-calculates discount %)
- ✅ No manual schedule input
- ✅ Package schedules automatically pulled from selected services
- ✅ Image upload support (multiple images)
- ✅ Quantity field removed from UI

### Package Display for Customers (Booking Page)
- ✅ Packages displayed clearly as "Package"
- ✅ Name format: "Package (Save X%): [Service Name 1] + [Service Name 2] + ..."
- ✅ Save percentage auto-calculated from original_price and total_price
- ✅ Service names joined with "+" in selection order
- ✅ Original price shown (strikethrough) when discount exists
- ✅ Save percentage prominently displayed

## 📋 Test Data Created

### Services (10 total)
1. Burj Khalifa Observation Deck - 150 SAR
2. Dubai Aquarium & Underwater Zoo - 120 SAR
3. Desert Safari Adventure - 200 SAR
4. Dubai Marina Cruise - 80 SAR
5. Dubai Frame Experience - 60 SAR
6. IMG Worlds of Adventure - 250 SAR
7. Dubai Museum & Al Fahidi Fort - 30 SAR
8. Dubai Garden Glow - 70 SAR
9. Dubai Miracle Garden - 55 SAR
10. Dubai Gold Souk Tour - 40 SAR

### Packages (5 total)
1. **Dubai Essentials Package** (15% off)
   - Burj Khalifa Observation Deck
   - Dubai Aquarium & Underwater Zoo
   - Dubai Marina Cruise
   - Original: 350 SAR → Final: 297.5 SAR

2. **Dubai Adventure Combo** (20% off)
   - Desert Safari Adventure
   - IMG Worlds of Adventure
   - Dubai Garden Glow
   - Original: 520 SAR → Final: 416 SAR

3. **Dubai Culture & Heritage** (10% off)
   - Dubai Museum & Al Fahidi Fort
   - Dubai Gold Souk Tour
   - Dubai Frame Experience
   - Original: 130 SAR → Final: 117 SAR

4. **Dubai Family Fun Package** (18% off)
   - Dubai Aquarium & Underwater Zoo
   - IMG Worlds of Adventure
   - Dubai Miracle Garden
   - Original: 425 SAR → Final: 348.5 SAR

5. **Dubai Premium Experience** (25% off)
   - Burj Khalifa Observation Deck
   - Desert Safari Adventure
   - Dubai Marina Cruise
   - IMG Worlds of Adventure
   - Original: 680 SAR → Final: 510 SAR

## 🔐 Test Accounts

### Service Provider
- **Email:** zain@gmail.com
- **Password:** 1111
- **Role:** tenant_admin
- **Use for:** Creating and managing packages

### Test Customer
- **Email:** testuser@example.com
- **Password:** TestUser123!
- **Role:** customer
- **Use for:** Viewing and booking packages

## 🧪 Testing Checklist

### Package Creation (Service Provider)
1. ✅ Login as zain@gmail.com
2. ✅ Navigate to Packages page
3. ✅ Click "Add Package"
4. ✅ Verify:
   - Must select at least 2 services
   - Total price auto-calculates (read-only)
   - Original price auto-calculates (read-only)
   - Can set discount percentage
   - Can set final price (auto-calculates discount %)
   - Can upload multiple images
   - No quantity field visible
   - No schedule input field

### Package Display (Customer View)
1. ✅ Login as testuser@example.com (or view as guest)
2. ✅ Navigate to booking page
3. ✅ Select a service that has packages
4. ✅ Verify package display:
   - Shows as "Package (Save X%): Service1 + Service2 + ..."
   - Original price shown (strikethrough) if discounted
   - Final price displayed prominently
   - Save percentage shown
   - Service names in correct order with "+"

### Schedule Inheritance
1. ✅ Select a package
2. ✅ Verify available time slots appear
3. ✅ Verify slots come from all services in package
4. ✅ Verify slots are filtered correctly by day of week

### Price Calculations
1. ✅ Verify original_price = sum of all service prices
2. ✅ Verify discount_percentage calculated correctly
3. ✅ Verify total_price = original_price - discount
4. ✅ Verify save percentage displayed correctly

## 🚀 Setup Instructions

1. **Run Migrations:**
   ```sql
   -- Run in Supabase SQL Editor or via migration tool
   -- Files to run:
   - 20251201000000_add_package_discount_fields.sql
   - 20251201000001_add_package_images.sql
   - 20251201000002_create_test_packages_data.sql
   ```

2. **Add Service Images:**
   - Images should be added manually via the Services page
   - Or use the assets folder if available

3. **Create Schedules for Services:**
   - Each service needs at least one shift/schedule
   - Go to Services page → Manage Schedules
   - Create shifts for each service

4. **Verify Packages:**
   - Login as zain@gmail.com
   - Go to Packages page
   - Verify all 5 packages are created
   - Edit packages to add images if needed

## 📝 Notes

- Package schedules are automatically inherited from selected services
- When a package is selected, available slots come from all services in the package
- The package name format is auto-generated on display, not stored
- Original price is always calculated from service prices (cannot be manually set)
- Discount can be set via percentage or final price (mutually calculated)

## 🐛 Known Issues / Future Improvements

- Package schedules currently use slots from the service being viewed
- Future: Could enhance to show slots from all services in package
- Images need to be added manually after service creation
- Test user creation may require auth setup



