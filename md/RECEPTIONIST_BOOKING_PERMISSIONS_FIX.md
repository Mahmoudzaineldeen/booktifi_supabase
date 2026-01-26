# Receptionist Booking Permissions - Full Access

## Changes Made

Updated booking endpoints to ensure receptionists have the same permissions as service providers (tenant admins) for editing and rescheduling bookings.

### 1. PATCH `/bookings/:id` - General Booking Update

**File**: `server/src/routes/bookings.ts`

**Before**:
- `slot_id` was conditionally added to allowedFields only if the user was tenant_admin or receptionist AND slot_id was in updateData
- Confusing comment said "Only tenant_admin can change slot_id (receptionist cannot)" but code allowed both

**After**:
- `slot_id` is now always included in allowedFields for receptionists and tenant admins
- Clear comment: "Receptionists and tenant_admin can edit all booking fields including rescheduling (slot_id)"
- Removed conditional check - both roles can always reschedule

**Code Change**:
```typescript
// Before
const allowedFields = [
  'customer_name',
  'customer_phone',
  // ... other fields
];
if ((req.user!.role === 'tenant_admin' || req.user!.role === 'receptionist') && 'slot_id' in updateData) {
  allowedFields.push('slot_id');
}

// After
const allowedFields = [
  'customer_name',
  'customer_phone',
  // ... other fields
  'slot_id', // Receptionists and tenant admins can reschedule bookings
];
```

### 2. PATCH `/bookings/:id/time` - Atomic Booking Time Edit

**File**: `server/src/routes/bookings.ts`

**Before**:
- Used `authenticateTenantAdminOnly` middleware
- Only tenant admins could use this endpoint
- Comment said "CRITICAL: Only tenant_admin can edit booking time"

**After**:
- Uses `authenticateReceptionistOrTenantAdmin` middleware
- Both receptionists and tenant admins can use this endpoint
- Updated comment to reflect new permissions

**Code Change**:
```typescript
// Before
router.patch('/:id/time', authenticateTenantAdminOnly, async (req, res) => {

// After
router.patch('/:id/time', authenticateReceptionistOrTenantAdmin, async (req, res) => {
```

## Permissions Summary

### Receptionists Can Now:
✅ Create bookings (already had this)
✅ Edit booking details (customer info, visitor count, etc.)
✅ Reschedule bookings (change slot_id)
✅ Use atomic booking time edit endpoint
✅ Update booking status
✅ Update payment status (if allowed by other endpoints)
✅ Search bookings (already had this)
✅ Validate QR codes (already fixed)

### Receptionists Cannot:
❌ Delete bookings (still restricted to tenant_admin only)
❌ Manage payment status via certain endpoints (if restricted elsewhere)

## Endpoints Updated

1. **PATCH `/api/bookings/:id`**
   - Middleware: `authenticateReceptionistOrTenantAdmin` ✅
   - Can edit: All fields including `slot_id` ✅

2. **PATCH `/api/bookings/:id/time`**
   - Middleware: Changed from `authenticateTenantAdminOnly` to `authenticateReceptionistOrTenantAdmin` ✅
   - Can use atomic RPC function for time edits ✅

## Testing

After deployment, test that receptionists can:
1. Edit booking customer information
2. Reschedule bookings to different time slots
3. Use the atomic booking time edit endpoint
4. Update booking status and other fields

## Files Modified

- `server/src/routes/bookings.ts`
  - Line ~2223: Updated allowedFields to always include `slot_id`
  - Line ~2573: Changed middleware from `authenticateTenantAdminOnly` to `authenticateReceptionistOrTenantAdmin`

---

**Status**: ✅ Complete
**Last Updated**: 2026-01-25
**Impact**: Receptionists now have full booking editing and rescheduling permissions equal to service providers
