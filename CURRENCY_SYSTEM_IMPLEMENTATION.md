# Global Currency System Implementation

## Overview
This document tracks the implementation of a global, tenant-based currency system that replaces all hardcoded currency references throughout the application.

## Implementation Status

### ✅ Completed

1. **Database Schema**
   - ✅ Migration: `20260124000003_add_currency_to_tenants.sql`
   - ✅ Added `currency_code` column to `tenants` table
   - ✅ Default: 'SAR' for backward compatibility
   - ✅ Constraint: Validates currency codes (SAR, USD, GBP, EUR)

2. **Currency Definitions**
   - ✅ Created `src/lib/currency.ts`
   - ✅ Defines all supported currencies with symbols, names, formatting rules
   - ✅ Includes new Saudi Riyal symbol (ر.س)
   - ✅ Provides `formatCurrency()` utility function

3. **Currency Context**
   - ✅ Created `src/contexts/CurrencyContext.tsx`
   - ✅ Provides global currency state via React Context
   - ✅ Auto-loads currency from tenant settings
   - ✅ Provides `useCurrency()` hook with `formatPrice()` function
   - ✅ Integrated into App.tsx

4. **Backend API**
   - ✅ Created `GET /api/tenants/currency` endpoint
   - ✅ Created `PUT /api/tenants/currency` endpoint (tenant admin only)
   - ✅ Validates currency codes
   - ✅ Warns about unpaid invoices

5. **Settings Page**
   - ✅ Added currency selection UI (tenant admin only)
   - ✅ Currency dropdown with all supported currencies
   - ✅ Save functionality with API integration
   - ✅ Success/error messaging
   - ✅ Auto-refreshes currency context after save

6. **Partial Frontend Updates**
   - ✅ `PackagesPage.tsx` - Replaced hardcoded SAR references
   - ✅ `ServicesPage.tsx` - Replaced most hardcoded SAR references

### 🔄 In Progress

7. **Remaining Frontend Files** (Need currency replacement)
   - ⏳ `BookingsPage.tsx` - Booking displays
   - ⏳ `ReceptionPage.tsx` - Receptionist booking interface
   - ⏳ `CashierPage.tsx` - Cashier interface
   - ⏳ `PublicBookingPage.tsx` - Public booking page
   - ⏳ `ServiceBookingFlow.tsx` - Service booking flow
   - ⏳ `PackageSchedulePage.tsx` - Package scheduling
   - ⏳ `CheckoutPage.tsx` - Checkout page
   - ⏳ `BookingSuccessPage.tsx` - Success page
   - ⏳ `QRScannerPage.tsx` - QR scanner
   - ⏳ `CustomerDashboard.tsx` - Customer dashboard
   - ⏳ `CustomerBillingPage.tsx` - Customer billing

8. **Backend Services** (Need currency integration)
   - ⏳ `server/src/services/pdfService.ts` - PDF ticket generation
   - ⏳ `server/src/services/zohoService.ts` - Zoho invoice creation (display only)
   - ⏳ `server/src/routes/bookings.ts` - Booking HTML email templates

## Replacement Pattern

### Before (Hardcoded):
```typescript
{price} {t('common.sar')}
{price} {t('service.currency') || 'SAR'}
{price} SAR
{price.toFixed(2)} SAR
```

### After (Dynamic):
```typescript
import { useCurrency } from '../../contexts/CurrencyContext';

const { formatPrice } = useCurrency();

// Then use:
{formatPrice(price)}
{formatPrice(price, { showDecimals: false })}
```

## Files Requiring Updates

### High Priority (User-Facing)
1. `src/pages/public/CheckoutPage.tsx` - Many price displays
2. `src/pages/public/PublicBookingPage.tsx` - Service prices
3. `src/pages/reception/ReceptionPage.tsx` - Booking prices
4. `src/pages/cashier/CashierPage.tsx` - Payment displays
5. `src/pages/public/ServiceBookingFlow.tsx` - Price calculations
6. `src/pages/public/PackageSchedulePage.tsx` - Package prices

### Medium Priority
7. `src/pages/tenant/BookingsPage.tsx` - Booking list prices
8. `src/pages/public/BookingSuccessPage.tsx` - Success page prices
9. `src/pages/public/QRScannerPage.tsx` - QR display prices
10. `src/pages/customer/CustomerDashboard.tsx` - Customer view
11. `src/pages/customer/CustomerBillingPage.tsx` - Billing page

### Backend Services
12. `server/src/services/pdfService.ts` - PDF generation (line 883, 1070)
13. `server/src/services/zohoService.ts` - Invoice creation (line 469, 1075, 1202)
14. `server/src/routes/bookings.ts` - Email templates (line 1894)

## Next Steps

1. Continue replacing hardcoded references in remaining frontend files
2. Update PDF service to fetch tenant currency and use it
3. Update Zoho service to use tenant currency (display only)
4. Update email templates to use tenant currency
5. Test currency changes across all pages
6. Verify backward compatibility

## Testing Checklist

- [ ] Currency selection persists after refresh
- [ ] Currency changes propagate without logout
- [ ] All prices display correct currency symbol
- [ ] Invoices show correct currency
- [ ] Tickets (PDF) show correct currency
- [ ] Email notifications show correct currency
- [ ] No hardcoded SAR/USD/$ remains
- [ ] Works for all roles (admin, receptionist, cashier, customer)
- [ ] Existing invoices keep original currency
- [ ] New invoices use new currency
