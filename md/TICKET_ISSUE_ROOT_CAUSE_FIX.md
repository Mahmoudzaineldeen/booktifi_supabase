# Ticket Issue Root Cause & Fix

## Root Cause Identified

The issue is that **ticket generation depends on `bookingId` being extracted correctly** from the RPC function response. If the RPC function:
1. Is not deployed → Booking creation fails entirely
2. Returns data in unexpected format → `bookingId` is undefined → Ticket generation never runs
3. Returns null/undefined → `bookingId` is undefined → Ticket generation never runs

## Critical Fix Applied

### File: `server/src/routes/bookings.ts`

**Added comprehensive logging and error handling:**

1. **RPC Function Existence Check**
   - Detects if `create_booking_with_lock` function doesn't exist
   - Provides clear error message with deployment instructions

2. **Response Format Logging**
   - Logs the type of response (string, object, null)
   - Logs whether ID is present
   - Logs raw response for debugging

3. **Enhanced Error Messages**
   - Clear error when bookingId is missing
   - Explains that ticket generation cannot proceed
   - Shows full response data for debugging

4. **Better JSONB Parsing**
   - Handles both string and object responses
   - Logs parsing success/failure
   - Falls back gracefully

## What to Check

### 1. Verify RPC Function is Deployed

Run this in Supabase SQL Editor:
```sql
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'create_booking_with_lock';
```

If no results, deploy the function:
```sql
-- Copy and run: database/create_booking_with_lock_function.sql
```

### 2. Check Server Logs

When creating a booking, you should now see:

```
[Booking Creation] Calling create_booking_with_lock RPC function...
[Booking Creation] RPC Response received: { type: 'object', hasId: true, ... }
[Booking Creation] ✅ Booking created successfully: <ID>
[Booking Creation]    Customer: <name>
[Booking Creation]    Email: <email>
[Booking Creation]    Phone: <phone>
🎫 TICKET GENERATION SCHEDULED for booking <ID>
```

### 3. If You See Errors

**Error: "RPC function does not exist"**
- Deploy: `database/create_booking_with_lock_function.sql` to Supabase

**Error: "Booking created but no ID found"**
- Check the logged response format
- Verify RPC function returns JSONB with `id` field
- Check if function was modified

**Error: "RPC returned null/undefined"**
- Function executed but returned no data
- Check function logic
- Verify database permissions

## Testing

1. **Deploy RPC Function** (if not already deployed)
2. **Restart Server** to load new logging
3. **Create a Booking** via UI or API
4. **Check Server Logs** for the new detailed messages
5. **Verify Ticket Generation** runs (should see "TICKET GENERATION SCHEDULED")

## Expected Flow

```
Booking Request
    ↓
Call create_booking_with_lock RPC
    ↓
Parse JSONB Response (string or object)
    ↓
Extract bookingId
    ↓
✅ If bookingId exists → Schedule ticket generation
❌ If bookingId missing → Return error (tickets won't generate)
```

## Next Steps

1. Check if RPC function is deployed
2. Create a test booking
3. Review server logs for the new diagnostic messages
4. Share logs if issues persist
