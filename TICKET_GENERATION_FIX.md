# Ticket Generation Fix

## Problem
Tickets were not being generated/sent after booking creation.

## Root Causes Identified

1. **Missing `create_booking_with_lock` function** - The database function was missing, causing booking creation to fail
2. **JSONB response handling** - The RPC function returns JSONB which needs proper parsing
3. **Booking ID extraction** - The booking ID wasn't being extracted correctly from the JSONB response
4. **Error handling** - Errors in ticket generation were being silently caught

## Fixes Applied

### 1. Created `create_booking_with_lock` Function
- **File**: `database/create_booking_with_lock_function.sql`
- **Status**: ✅ Created
- **Action Required**: Apply this SQL to your Supabase database via SQL Editor
- **Instructions**: See `APPLY_BOOKING_FUNCTION.md`

### 2. Fixed Booking ID Extraction
- **File**: `server/src/routes/bookings.ts`
- **Changes**:
  - Added JSONB parsing for booking response
  - Properly extract `bookingId` from JSONB response
  - Use `bookingId` consistently throughout ticket generation

### 3. Improved Ticket Generation
- **File**: `server/src/routes/bookings.ts`
- **Changes**:
  - Better error handling and logging
  - Use `sendBookingTicketEmail` from emailService (handles SMTP from database)
  - Ensure tickets are ALWAYS generated (even if delivery fails)
  - Improved logging for debugging

### 4. Fixed Parameter Names
- **File**: `server/src/routes/bookings.ts`
- **Change**: Fixed `p_reserved_by_session_id` → `p_session_id` for `acquire_booking_lock`

## Current Ticket Generation Flow

```
Booking Created
   ↓
Extract Booking ID from JSONB response
   ↓
Generate PDF Ticket (generateBookingTicketPDFBase64)
   ↓
Send via WhatsApp (if phone provided)
   ↓
Send via Email (if email provided)
```

## What You Need to Do

### Step 1: Apply Database Function
1. Open Supabase SQL Editor
2. Copy contents of `database/create_booking_with_lock_function.sql`
3. Paste and run in SQL Editor

### Step 2: Verify Configuration
- ✅ WhatsApp settings configured (already done)
- ⚠️ SMTP settings - Check if configured in tenant settings
- ⚠️ Ensure booking has email OR phone for delivery

### Step 3: Test Booking
1. Create a new booking
2. Check server logs for ticket generation messages
3. Verify ticket is sent via WhatsApp/Email

## Expected Log Output

When a booking is created, you should see:

```
✅ Booking created successfully: <booking-id>
📧 Starting ticket generation for booking <booking-id>...
📄 Step 1: Generating PDF for booking <booking-id>...
✅ Step 1 Complete: PDF generated successfully (XXXX bytes)
📱 Step 2: Attempting to send ticket via WhatsApp...
✅ Step 2 Complete: Ticket PDF sent via WhatsApp
📧 Step 3: Attempting to send ticket via Email...
✅ Step 3 Complete: Ticket PDF sent via Email
✅ Ticket sending process completed for booking <booking-id>
```

## Troubleshooting

### If tickets still not received:

1. **Check server logs** for errors during PDF generation
2. **Verify SMTP settings** in tenant settings (if using email)
3. **Verify WhatsApp settings** in tenant settings (if using WhatsApp)
4. **Check booking has email/phone** - Tickets require at least one contact method
5. **Verify `create_booking_with_lock` function exists** in database

### Common Issues:

- **"Function not found"** → Apply the SQL function
- **"PDF generation failed"** → Check booking exists in database
- **"Email not sent"** → Check SMTP configuration
- **"WhatsApp not sent"** → Check WhatsApp configuration
