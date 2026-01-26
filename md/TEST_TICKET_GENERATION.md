# Test Ticket Generation - Complete Guide

## Quick Test

Run this script to create a booking and test ticket generation:

```bash
node scripts/test-booking-tickets.js
```

Or the minimal version:

```bash
node scripts/test-tickets-minimal.js
```

## What the Test Does

1. ✅ Checks server is running
2. ✅ Logs in as service provider
3. ✅ Finds an available service
4. ✅ Finds an available time slot
5. ✅ Acquires booking lock
6. ✅ Creates a booking with:
   - Email: `mahmoudnzaineldeen@gmail.com`
   - Phone: `+201032560826`
7. ✅ Waits for ticket generation
8. ✅ Provides instructions to check delivery

## What to Check

### 1. Server Console (MOST IMPORTANT!)

After booking is created, immediately check your server console. You should see:

```
📧 ========================================
📧 Starting ticket generation for booking <ID>...
   Customer: Test Customer
   Email: mahmoudnzaineldeen@gmail.com
   Phone: +201032560826
📧 ========================================

📄 Step 1: Generating PDF for booking <ID>...
✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)

📱 Step 2: Attempting to send ticket via WhatsApp to +201032560826...
✅ Step 2 Complete: Ticket PDF sent via WhatsApp to +201032560826

📧 Step 3: Attempting to send ticket via Email to mahmoudnzaineldeen@gmail.com...
✅ Step 3 Complete: Ticket PDF sent via Email to mahmoudnzaineldeen@gmail.com
```

### 2. Email Delivery

- **Check**: `mahmoudnzaineldeen@gmail.com`
- **Subject**: "Booking Ticket"
- **Attachment**: `booking_ticket_<ID>.pdf`
- **Check spam folder** if not in inbox

### 3. WhatsApp Delivery

- **Check**: `+201032560826`
- **Message**: "Your booking is confirmed! Please find your ticket attached."
- **Attachment**: PDF ticket

## Troubleshooting

### No Ticket Generation Logs

**Problem**: Server console shows no ticket generation logs

**Possible Causes**:
1. Booking creation failed
2. Booking ID not extracted correctly
3. Ticket generation code not executing

**Solution**:
- Check if booking was actually created
- Verify booking ID in response
- Check server console for booking creation logs

### PDF Generation Fails

**Problem**: Server shows "❌ CRITICAL ERROR: Failed to generate PDF"

**Possible Causes**:
1. Booking data incomplete
2. PDF service error
3. Missing service/slot/tenant data

**Solution**:
- Check server console for PDF generation errors
- Verify booking has all required fields
- Check PDF service logs

### Email Not Sent

**Problem**: Step 3 shows error or email not received

**Possible Causes**:
1. SMTP settings not configured
2. Invalid SMTP credentials
3. Email service error

**Solution**:
- Check tenant SMTP settings
- Verify SMTP credentials are correct
- Check server console for email errors
- Check email spam folder

### WhatsApp Not Sent

**Problem**: Step 2 shows error or WhatsApp not received

**Possible Causes**:
1. WhatsApp settings not configured
2. Invalid access token
3. Phone number format issue
4. Meta API error

**Solution**:
- Check tenant WhatsApp settings
- Verify access token is valid (not expired)
- Check server console for WhatsApp API errors
- Check Meta Business Dashboard for message status

## Expected Flow

```
Booking Created
    ↓
Extract Booking ID
    ↓
process.nextTick() → Async ticket generation
    ↓
Step 1: Generate PDF
    ↓
Step 2: Send via WhatsApp (if phone provided)
    ↓
Step 3: Send via Email (if email provided)
```

## Verification Checklist

After running the test:

- [ ] Booking created successfully
- [ ] Server console shows "Starting ticket generation"
- [ ] Server console shows "Step 1 Complete: PDF generated"
- [ ] Server console shows "Step 2 Complete: WhatsApp sent" (if phone provided)
- [ ] Server console shows "Step 3 Complete: Email sent" (if email provided)
- [ ] Email received with PDF attachment
- [ ] WhatsApp received with PDF attachment
- [ ] PDF opens correctly

## Manual Test via UI

1. Go to: `http://localhost:5173/fci/book`
2. Select a service
3. Select a date and time slot
4. Enter:
   - Name: Test Customer
   - Email: `mahmoudnzaineldeen@gmail.com`
   - Phone: `+201032560826`
5. Complete booking
6. **Immediately check server console** for ticket logs
7. Check email and WhatsApp

## Test Scripts Available

1. **test-booking-tickets.js** - Full test with lock acquisition
2. **test-tickets-minimal.js** - Minimal version
3. **test-booking-ticket-generation.js** - Comprehensive test
4. **test-ticket-generation-simple.js** - Simple check and instructions

## Key Points

- **Tickets are generated ASYNCHRONOUSLY** - they don't block the booking response
- **Check SERVER CONSOLE** - all ticket generation logs are there
- **Tickets are ALWAYS generated** - even if delivery fails
- **PDF is generated FIRST** - then sent via email/WhatsApp
- **Each step is logged** - check server console for each step
