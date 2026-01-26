# Manual Test: Booking Time Edit with Ticket Invalidation

## Prerequisites

1. **Service Provider Account:**
   - Email: `mahmoudnzaineldeen@gmail.com`
   - Password: `111111`

2. **Requirements:**
   - At least one existing booking
   - At least two slots for the same service (one for current booking, one alternative)

## Test Steps

### Step 1: Access Bookings Page as Service Provider

1. Log in as service provider: `mahmoudnzaineldeen@gmail.com` / `111111`
2. Navigate to: `/:tenantSlug/admin/bookings`
3. Find an existing booking (status: `pending` or `confirmed`)

### Step 2: Note Current Booking Details

Before editing, note:
- **Booking ID**: (from URL or booking card)
- **Current Slot**: Date and time
- **Customer Email**: (for verification)
- **Customer Phone**: (for verification)
- **QR Token**: Check if present (inspect booking details)

### Step 3: Edit Booking Time

1. Click **"Change Time"** button on the booking card
2. In the modal:
   - Select a **new date** (must have available slots)
   - Select a **new time slot** from available options
3. Click **"Update Time"**
4. Confirm the warning about ticket invalidation

### Step 4: Verify Old Ticket Invalidation

After the edit completes:

1. **Check Booking Details:**
   - Slot ID should be updated to new slot
   - `qr_scanned` should be `true`
   - `qr_token` should be `NULL` (cleared)
   - `qr_scanned_at` should be set to current timestamp

2. **Test Old QR Code:**
   - Try scanning the old QR code (if you have it)
   - Should be rejected as invalid/scanned

### Step 5: Verify New Ticket Generation

1. **Check Booking Details:**
   - New `qr_token` should be generated (different from old)
   - `qr_scanned` should remain `true` (old ticket marked as scanned)
   - New ticket should be associated with new slot

2. **Check Customer Notifications:**
   - **Email**: Check customer's email inbox for new ticket PDF
   - **WhatsApp**: Check customer's WhatsApp for new ticket message
   - New ticket should have new QR code

### Step 6: Verify Slot Capacity Updates

1. **Old Slot:**
   - Capacity should increase by visitor_count
   - Available capacity should reflect the released booking

2. **New Slot:**
   - Capacity should decrease by visitor_count
   - Available capacity should reflect the new booking

## Expected Results

✅ **Old Ticket Invalidated:**
- `qr_token = NULL`
- `qr_scanned = true`
- `qr_scanned_at` = current timestamp
- Old QR code no longer works

✅ **New Ticket Generated:**
- New `qr_token` created
- New ticket PDF generated
- New ticket sent to customer

✅ **Slot Capacity Updated:**
- Old slot capacity increased
- New slot capacity decreased

✅ **Booking Updated:**
- `slot_id` = new slot ID
- `updated_at` = current timestamp

## Verification Queries

Run these in Supabase SQL Editor to verify:

```sql
-- Check booking state
SELECT 
  id,
  slot_id,
  qr_token,
  qr_scanned,
  qr_scanned_at,
  qr_scanned_by_user_id,
  updated_at
FROM bookings
WHERE id = 'YOUR_BOOKING_ID';

-- Check slot capacities
SELECT 
  id,
  available_capacity,
  booked_count,
  original_capacity
FROM slots
WHERE id IN ('OLD_SLOT_ID', 'NEW_SLOT_ID');

-- Check audit log
SELECT *
FROM audit_logs
WHERE resource_type = 'booking'
  AND resource_id = 'YOUR_BOOKING_ID'
  AND action_type = 'booking_time_edit'
ORDER BY created_at DESC
LIMIT 1;
```

## Troubleshooting

### Issue: "No alternative slots found"
**Solution:** Create more slots for the service via admin panel

### Issue: "New slot belongs to a different service"
**Solution:** Ensure the new slot is from the same service as the booking

### Issue: "Not enough capacity"
**Solution:** Ensure the new slot has enough available capacity for the visitor count

### Issue: New ticket not generated
**Check:**
- Server logs for ticket generation
- Async job status
- Email/WhatsApp service status

## Success Criteria

All of the following must be true:

1. ✅ Booking time successfully updated
2. ✅ Old ticket invalidated (qr_token cleared, qr_scanned = true)
3. ✅ New ticket generated (new qr_token created)
4. ✅ New ticket sent to customer (email + WhatsApp)
5. ✅ Slot capacities correctly updated
6. ✅ Audit log entry created
7. ✅ Old QR code no longer works
8. ✅ New QR code works correctly

---

**Last Updated:** 2026-01-22
