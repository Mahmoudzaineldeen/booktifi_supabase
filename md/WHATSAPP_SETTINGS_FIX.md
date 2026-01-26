# WhatsApp Settings Fix

## Issue
Error: `❌ WhatsApp settings not configured in database for tenant`

## Root Cause
The error occurs in `/guest/verify-phone` endpoint when trying to send OTP via WhatsApp. Even though WhatsApp settings exist in the database, the code wasn't finding them due to:

1. **Missing tenant_id** - If `tenant_id` is not provided in the request, WhatsApp config cannot be fetched
2. **Silent query failures** - Database errors were being caught but not logged properly
3. **Missing validation** - Settings might exist but be missing required fields

## Fix Applied

### File: `server/src/routes/auth.ts`

**Changes:**
1. ✅ Added detailed error logging for database queries
2. ✅ Added validation for required fields (phone_number_id, access_token for Meta)
3. ✅ Added warning when tenant_id is missing
4. ✅ Improved error messages to show exactly what's wrong

**New Logging:**
- Shows if tenant_id is missing
- Shows database query errors
- Shows if settings exist but are missing required fields
- Shows which tenant_id is being queried

## Current Status

✅ **WhatsApp settings ARE configured** in the database:
- Provider: `meta` ✅
- Phone Number ID: SET ✅
- Access Token: SET ✅

## What to Check

When you see the error, check your **SERVER TERMINAL** for these new detailed logs:

1. **If tenant_id is missing:**
   ```
   ⚠️  No tenant_id provided in request - cannot fetch WhatsApp settings
   ```

2. **If database query fails:**
   ```
   ❌ Error fetching tenant WhatsApp settings: <error message>
      Tenant ID: <id>
   ```

3. **If settings missing required fields:**
   ```
   ⚠️  WhatsApp settings found but missing required fields for Meta provider
      Required: phone_number_id, access_token
   ```

4. **If settings are null:**
   ```
   ⚠️  Tenant <id> found but whatsapp_settings is null or empty
   ```

## Next Steps

1. **Check server logs** - The new detailed logs will show exactly why WhatsApp settings aren't being found
2. **Verify tenant_id** - Make sure `tenant_id` is being passed in requests that need WhatsApp
3. **Test again** - Create a booking or request OTP and check the detailed logs

## Testing

Run the check script to verify settings:
```bash
node scripts/check-and-fix-whatsapp-settings.js
```

This will show:
- Current WhatsApp settings status
- Required fields for your provider
- Instructions to fix if needed

## Related Endpoints

The error can occur in:
- `/api/auth/guest/verify-phone` - Guest phone verification
- `/api/bookings/create` - Booking ticket generation (WhatsApp delivery)
- Any endpoint that sends WhatsApp messages

All now have improved error logging to help diagnose issues.
