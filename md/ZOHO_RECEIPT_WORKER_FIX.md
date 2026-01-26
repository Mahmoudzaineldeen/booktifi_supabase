# Zoho Receipt Worker - Strict Billing & Missing Booking Fix

## Issue
The Zoho receipt worker was:
1. Retrying jobs for bookings that don't exist (deleted test bookings)
2. Not checking strict billing rules before processing (should skip fully package-covered bookings)
3. Not handling missing bookings gracefully

## Root Cause
- Worker threw errors for missing bookings, causing unnecessary retries
- No validation of `paid_quantity` and `total_price` before processing
- Orphaned jobs for deleted bookings were retried indefinitely

## Solution
Enhanced the worker to:
1. Handle missing bookings gracefully (mark as failed, no retry)
2. Enforce strict billing rules (skip jobs for bookings that shouldn't have invoices)
3. Clean up orphaned jobs for deleted bookings

## Changes Made

### 1. Graceful Missing Booking Handling
**File:** `server/src/jobs/zohoReceiptWorker.ts` (lines 38-50)

**Before:**
```typescript
if (bookingError || !booking) {
  throw new Error(`Booking ${booking_id} not found`);
}
```

**After:**
```typescript
// Use maybeSingle to avoid throwing error if booking doesn't exist
const { data: booking, error: bookingError } = await supabase
  .from('bookings')
  .select('zoho_invoice_id, payment_status, paid_quantity, package_covered_quantity, total_price')
  .eq('id', booking_id)
  .maybeSingle();

// Handle missing booking gracefully
if (bookingError || !booking) {
  console.warn(`[ZohoReceiptWorker] ⚠️ Booking ${booking_id} not found - marking job as failed`);
  await supabase
    .from('queue_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString()
    })
    .eq('id', job.id);
  return { success: false, error: `Booking ${booking_id} not found (may have been deleted)` };
}
```

### 2. Strict Billing Rule Enforcement
**File:** `server/src/jobs/zohoReceiptWorker.ts` (lines 62-90)

Added validation before processing:
- ✅ Check `paid_quantity > 0` (has paid portion)
- ✅ Check `total_price > 0` (money is owed)
- ✅ Skip jobs for fully package-covered bookings
- ✅ Mark job as completed (not failed) if no invoice needed

```typescript
// STRICT BILLING RULE: Invoice ONLY when real money is owed
const paidQty = booking.paid_quantity ?? /* fallback logic */;
const totalPrice = parseFloat(booking.total_price?.toString() || '0');

if (paidQty <= 0 || totalPrice <= 0) {
  console.log(`[ZohoReceiptWorker] ⚠️ Booking should NOT have invoice (strict billing rule)`);
  // Mark as completed (not failed) - this is correct behavior
  await supabase
    .from('queue_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', job.id);
  return { success: true, error: 'Booking fully covered by package - no invoice needed' };
}
```

### 3. No Retry for Missing Bookings
**File:** `server/src/jobs/zohoReceiptWorker.ts` (lines 108-118)

**Before:**
- All errors triggered retries, including "booking not found"

**After:**
- Missing booking errors are handled immediately (no retry)
- Only transient errors trigger retries

```typescript
// Don't retry if booking doesn't exist (booking was deleted)
if (error.message?.includes('not found') || error.message?.includes('Booking')) {
  console.warn(`[ZohoReceiptWorker] ⚠️ Booking not found - marking job as failed (no retry)`);
  await supabase
    .from('queue_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString()
    })
    .eq('id', job.id);
  return { success: false, error: error.message };
}
```

### 4. Orphaned Job Cleanup
**File:** `server/src/jobs/zohoReceiptWorker.ts` (lines 157-178)

Added cleanup for old jobs (older than 1 hour):
- Check if booking still exists
- Mark orphaned jobs as failed if booking is deleted
- Prevents infinite retries for deleted bookings

```typescript
// Clean up orphaned jobs for deleted bookings (jobs older than 1 hour)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const oldJobs = jobs.filter((job: QueueJob) => {
  const createdAt = new Date(job.created_at);
  return createdAt < new Date(oneHourAgo);
});

if (oldJobs.length > 0) {
  for (const oldJob of oldJobs) {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', oldJob.payload.booking_id)
      .maybeSingle();

    if (!booking) {
      // Mark orphaned job as failed
      await supabase
        .from('queue_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', oldJob.id);
    }
  }
}
```

## Benefits

1. ✅ **No More Unnecessary Retries**
   - Missing bookings are handled immediately
   - Orphaned jobs are cleaned up automatically

2. ✅ **Strict Billing Enforcement**
   - Jobs for fully package-covered bookings are skipped
   - Only bookings with `paid_quantity > 0` and `total_price > 0` are processed

3. ✅ **Better Error Handling**
   - Clear logging for missing bookings
   - Graceful handling of deleted bookings
   - Jobs marked as completed (not failed) when no invoice is needed

4. ✅ **Automatic Cleanup**
   - Old jobs for deleted bookings are automatically cleaned up
   - Prevents queue from filling with orphaned jobs

## Worker Behavior Now

### Scenario 1: Booking Doesn't Exist
- ✅ Job marked as failed immediately
- ✅ No retries
- ✅ Clear warning logged

### Scenario 2: Booking Fully Covered by Package
- ✅ Job marked as completed (not failed)
- ✅ No invoice created
- ✅ Logged as correct behavior

### Scenario 3: Booking Should Have Invoice
- ✅ Invoice created normally
- ✅ Job marked as completed

### Scenario 4: Orphaned Job (Old + Booking Deleted)
- ✅ Automatically cleaned up
- ✅ Marked as failed
- ✅ No more retries

## Testing

The worker will now:
- ✅ Handle test bookings that were deleted gracefully
- ✅ Skip jobs for fully package-covered bookings
- ✅ Only process jobs for bookings that should have invoices
- ✅ Clean up orphaned jobs automatically

## Status

✅ **FIXED** - Zoho receipt worker now handles missing bookings gracefully and enforces strict billing rules.
