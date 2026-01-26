# Manual Testing Guide - Remaining Tasks

This guide provides step-by-step instructions to manually test all implemented tasks.

## Prerequisites

1. **Test Accounts Required:**
   - Cashier account (role: `cashier`)
   - Receptionist account (role: `receptionist`)
   - Tenant Owner account (role: `tenant_admin`)

2. **Test Data Required:**
   - At least one active service
   - At least one available time slot (future date)
   - A test booking with an invoice

## TASK 5: Role-Based Access Enforcement

### Test 5.1: Cashier Can Scan QR Code ✅

**Steps:**
1. Sign in as **Cashier**
2. Navigate to Reception Page (or QR Scanner page)
3. Scan a valid booking QR code
4. **Expected:** QR code is validated, booking details displayed, booking marked as checked-in

### Test 5.2: Receptionist Cannot Scan QR Code ❌

**Steps:**
1. Sign in as **Receptionist**
2. Try to access QR scanner or scan a QR code
3. **Expected:** Access denied (403 error) or QR scanner not available

### Test 5.3: Tenant Owner Cannot Scan QR Code ❌

**Steps:**
1. Sign in as **Tenant Owner**
2. Try to access QR scanner or scan a QR code
3. **Expected:** Access denied (403 error) or QR scanner not available

### Test 5.4: Cashier Cannot Create Bookings ❌

**Steps:**
1. Sign in as **Cashier**
2. Try to create a new booking
3. **Expected:** Access denied (403 error) - "Only receptionists and tenant owners can create/edit bookings"

### Test 5.5: Receptionist Can Create Bookings ✅

**Steps:**
1. Sign in as **Receptionist**
2. Navigate to Reception Page
3. Create a new booking with valid data
4. **Expected:** Booking created successfully

### Test 5.6: Cashier Cannot Download Invoices ❌

**Steps:**
1. Sign in as **Cashier**
2. Try to download a booking invoice
3. **Expected:** Access denied (403 error) - "Cashiers cannot download invoices"

## TASK 7: Invoice Access for Receptionist

### Test 7.1: Receptionist Can Download Invoices ✅

**Steps:**
1. Sign in as **Receptionist**
2. Navigate to Bookings page
3. Find a booking with an invoice
4. Click "Download Invoice"
5. **Expected:** Invoice PDF downloads successfully

### Test 7.2: Tenant Owner Can Download Invoices ✅

**Steps:**
1. Sign in as **Tenant Owner**
2. Navigate to Bookings page
3. Find a booking with an invoice
4. Click "Download Invoice"
5. **Expected:** Invoice PDF downloads successfully

## TASK 8: Booking Time Editing (Tenant Owner Only)

### Test 8.1: Receptionist Cannot Reschedule Bookings ❌

**Steps:**
1. Sign in as **Receptionist**
2. Navigate to Bookings page
3. Try to edit a booking and change the time slot
4. **Expected:** Access denied (403 error) - "Only tenant owners can reschedule bookings"

### Test 8.2: Tenant Owner Can Reschedule Bookings ✅

**Steps:**
1. Sign in as **Tenant Owner**
2. Navigate to Bookings page
3. Edit a booking
4. Change the time slot to an available slot
5. **Expected:** 
   - Booking rescheduled successfully
   - Response includes `slot_changed: true`
   - Message: "Booking rescheduled successfully. New ticket has been sent to customer."

### Test 8.3: Validation - Cannot Reschedule to Unavailable Slot ❌

**Steps:**
1. Sign in as **Tenant Owner**
2. Try to reschedule a booking to a slot with insufficient capacity
3. **Expected:** Error (409) - "Not enough capacity" or "Selected time slot is not available"

### Test 8.4: Validation - Cannot Reschedule to Past Slot ❌

**Steps:**
1. Sign in as **Tenant Owner**
2. Try to reschedule a booking to a past time slot
3. **Expected:** Error (400) - "Cannot reschedule to a time slot in the past"

### Test 8.5: Validation - Cannot Change Service When Rescheduling ❌

**Steps:**
1. Sign in as **Tenant Owner**
2. Try to reschedule a booking to a slot from a different service
3. **Expected:** Error (400) - "New slot belongs to a different service. Cannot change service when rescheduling."

## TASK 9: Ticket Invalidation & Regeneration

### Test 9.1: Old QR Code Invalidated on Reschedule ✅

**Steps:**
1. Create a booking and note the QR code
2. Scan the QR code to verify it works
3. Sign in as **Tenant Owner**
4. Reschedule the booking to a different time slot
5. Try to scan the old QR code again
6. **Expected:** 
   - Old QR code no longer works (qr_scanned should be false)
   - New QR code is generated with updated time

### Test 9.2: New Ticket Generated on Reschedule ✅

**Steps:**
1. Reschedule a booking (as Tenant Owner)
2. Check the booking details
3. **Expected:** 
   - New ticket PDF is generated
   - QR code in new ticket points to updated time slot
   - Ticket shows new date/time

## TASK 10: Customer Notification (Ticket Update)

### Test 10.1: WhatsApp Notification Sent on Reschedule ✅

**Prerequisites:**
- Booking has customer phone number
- Tenant has WhatsApp configured

**Steps:**
1. Reschedule a booking (as Tenant Owner)
2. Check WhatsApp logs or customer's phone
3. **Expected:** 
   - WhatsApp message received: "Your booking time has been changed! Please find your updated ticket attached."
   - New ticket PDF attached

### Test 10.2: Email Notification Sent on Reschedule ✅

**Prerequisites:**
- Booking has customer email
- Tenant has SMTP configured

**Steps:**
1. Reschedule a booking (as Tenant Owner)
2. Check email logs or customer's email
3. **Expected:** 
   - Email received with subject about booking update
   - New ticket PDF attached
   - Email contains updated booking details

## API Endpoint Testing

You can also test the endpoints directly using curl or Postman:

### Test QR Validation (Cashier Only)
```bash
curl -X POST https://your-backend.com/api/bookings/validate-qr \
  -H "Authorization: Bearer CASHIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "BOOKING_ID"}'
```

### Test Booking Creation (Receptionist/Tenant Owner)
```bash
curl -X POST https://your-backend.com/api/bookings/create \
  -H "Authorization: Bearer RECEPTIONIST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slot_id": "SLOT_ID",
    "service_id": "SERVICE_ID",
    "tenant_id": "TENANT_ID",
    "customer_name": "Test Customer",
    "customer_phone": "+966501234567",
    "visitor_count": 1,
    "total_price": 100
  }'
```

### Test Booking Reschedule (Tenant Owner Only)
```bash
curl -X PATCH https://your-backend.com/api/bookings/BOOKING_ID \
  -H "Authorization: Bearer TENANT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slot_id": "NEW_SLOT_ID"}'
```

### Test Invoice Download (Receptionist/Tenant Owner)
```bash
curl -X GET https://your-backend.com/api/zoho/invoices/INVOICE_ID/download \
  -H "Authorization: Bearer RECEPTIONIST_TOKEN" \
  -o invoice.pdf
```

## Verification Checklist

- [ ] Cashier can scan QR codes
- [ ] Receptionist cannot scan QR codes
- [ ] Tenant Owner cannot scan QR codes
- [ ] Cashier cannot create bookings
- [ ] Receptionist can create bookings
- [ ] Cashier cannot download invoices
- [ ] Receptionist can download invoices
- [ ] Tenant Owner can download invoices
- [ ] Receptionist cannot reschedule bookings
- [ ] Tenant Owner can reschedule bookings
- [ ] Slot validation works (capacity, availability, past slots)
- [ ] Old QR code invalidated on reschedule
- [ ] New ticket generated on reschedule
- [ ] WhatsApp notification sent on reschedule
- [ ] Email notification sent on reschedule

## Troubleshooting

### "No services found"
- Create at least one active service in the tenant settings

### "No available slots found"
- Create time slots for future dates in the service schedule

### "Access denied" errors
- Verify user roles are correctly set in the database
- Check that JWT token contains correct role and tenant_id

### Notifications not sent
- Verify WhatsApp/SMTP settings are configured in tenant settings
- Check server logs for notification errors
- Ensure customer has valid phone/email in booking
