# Ticket Generation Test Guide

## Overview
This guide helps you test that PDF tickets are generated and sent when bookings are created.

## Test Scripts

### 1. Simple Test (`test-ticket-generation-simple.js`)
Checks if bookings exist and provides instructions.

**Usage**:
```bash
node scripts/test-ticket-generation-simple.js
```

### 2. Comprehensive Test (`test-booking-ticket-generation.js`)
Creates a booking and tests the complete flow.

**Usage**:
```bash
node scripts/test-booking-ticket-generation.js
```

**Requirements**:
- Available services
- Available time slots
- Valid authentication

## Manual Testing Steps

### Step 1: Prepare Test Data
1. **Create a Service** (if not exists)
   - Login as service provider
   - Go to Services → Create Service
   - Set name, duration, price, etc.

2. **Create a Shift**
   - Edit the service
   - Add a shift (e.g., Monday-Friday, 9 AM - 5 PM)
   - Save

3. **Generate Slots**
   - The system should auto-generate slots
   - Or manually trigger slot generation

### Step 2: Create a Booking

**Via UI**:
1. Go to: `http://localhost:5173/fci/book`
2. Select a service
3. Select a date and time slot
4. Enter customer details:
   - Name: Test Customer
   - Email: `mahmoudnzaineldeen@gmail.com`
   - Phone: `+201032560826`
5. Complete the booking

**Via API** (if you have slots):
```bash
node scripts/test-booking-ticket-generation.js
```

### Step 3: Monitor Server Console

Watch for these logs:

```
📧 ========================================
📧 Starting ticket generation for booking...
   Customer: Test Customer
   Email: mahmoudnzaineldeen@gmail.com
   Phone: +201032560826
📧 ========================================

📄 Step 1: Generating PDF for booking <ID>...
✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)

📱 Step 2: Attempting to send ticket via WhatsApp...
✅ Step 2 Complete: Ticket PDF sent via WhatsApp to +201032560826

📧 Step 3: Attempting to send ticket via Email...
✅ Step 3 Complete: Ticket PDF sent via Email to mahmoudnzaineldeen@gmail.com
```

### Step 4: Verify Delivery

**Email**:
- Check inbox: `mahmoudnzaineldeen@gmail.com`
- Subject: "Booking Ticket"
- Attachment: `booking_ticket_<ID>.pdf`
- Check spam folder if not found

**WhatsApp**:
- Check WhatsApp: `+201032560826`
- Message: "Your booking is confirmed! Please find your ticket attached."
- Attachment: PDF ticket

## Troubleshooting

### No Tickets Generated

**Check Server Console for**:
1. `❌ CRITICAL ERROR: Failed to generate PDF`
   - PDF service issue
   - Check booking data exists

2. `⚠️ Step 2 Skipped: No phone number provided`
   - Phone number missing
   - Check booking has customer_phone

3. `⚠️ Step 3 Skipped: No email provided`
   - Email missing
   - Check booking has customer_email

### PDF Generation Fails

**Possible Causes**:
- Booking data incomplete
- PDF service error
- Missing booking details (service, slot, tenant)

**Solution**:
- Check server console for PDF generation errors
- Verify booking has all required data

### Email Not Sent

**Possible Causes**:
- SMTP settings not configured
- Invalid SMTP credentials
- Email service error

**Check**:
- Tenant SMTP settings configured
- Server console for email errors
- Email spam folder

### WhatsApp Not Sent

**Possible Causes**:
- WhatsApp settings not configured
- Invalid access token
- Phone number format issue
- API error

**Check**:
- Tenant WhatsApp settings configured
- Server console for WhatsApp API errors
- Meta Business Dashboard for message status

## Expected Flow

```
Booking Created
    ↓
Extract Booking ID
    ↓
Generate PDF Ticket (Step 1)
    ↓
Send via WhatsApp (Step 2) ← If phone provided
    ↓
Send via Email (Step 3) ← If email provided
    ↓
✅ Complete
```

## Verification Checklist

- [ ] Booking created successfully
- [ ] Server console shows "Starting ticket generation"
- [ ] PDF generated (Step 1 Complete)
- [ ] WhatsApp sent (Step 2 Complete) - if phone provided
- [ ] Email sent (Step 3 Complete) - if email provided
- [ ] Email received with PDF attachment
- [ ] WhatsApp received with PDF attachment
- [ ] PDF opens correctly

## Quick Test

1. Create a booking via UI with email and phone
2. Immediately check server console
3. Look for ticket generation logs
4. Check email and WhatsApp within 10 seconds

If you see errors in the console, share them for troubleshooting.
