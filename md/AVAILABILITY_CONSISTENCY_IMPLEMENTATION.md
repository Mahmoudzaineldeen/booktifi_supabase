# Availability Consistency Implementation

## Summary

Unified booking availability logic has been implemented to ensure the Receptionist Booking page calculates and displays available shifts and time slots **exactly the same way** as the Customer Booking page.

## Changes Made

### 1. Created Shared Availability Utility (`src/lib/bookingAvailability.ts`)

**New File**: Centralized availability calculation logic used by both pages.

**Features**:
- Fetches shifts for the service
- Fetches slots for those shifts on the selected date
- Filters by `available_capacity > 0` (unless `includeZeroCapacity` is true)
- Fetches and filters out locked slots (unless `includeLockedSlots` is true)
- Filters by shift `days_of_week` (ensures slots match shift schedule)
- Filters out past time slots for today (unless `includePastSlots` is true)
- Orders by `start_time`

**API**:
```typescript
fetchAvailableSlots(options: AvailabilityOptions): Promise<AvailabilityResult>
```

### 2. Updated Customer Booking Page (`src/pages/public/PublicBookingPage.tsx`)

**Changes**:
- Replaced custom `fetchAvailableSlots()` implementation with shared utility
- Uses `fetchAvailableSlotsUtil()` with customer-specific options:
  - `includePastSlots: false` - Filter out past slots
  - `includeLockedSlots: false` - Filter out locked slots
  - `includeZeroCapacity: false` - Filter out fully booked slots

**Result**: Customer page now uses the unified logic.

### 3. Updated Receptionist Booking Page (`src/pages/reception/ReceptionPage.tsx`)

**Changes**:
- Replaced custom `fetchAvailableSlots()` implementation with shared utility
- Uses `fetchAvailableSlotsUtil()` with **identical options** as customer page:
  - `includePastSlots: false` - Filter out past slots (same as customer)
  - `includeLockedSlots: false` - Filter out locked slots (same as customer)
  - `includeZeroCapacity: false` - Filter out fully booked slots (same as customer)
- Keeps `filterConflictingSlots()` for multi-service bookings (receptionist-specific feature)
  - Only applies when `selectedServices.length > 0`
  - For single service bookings, returns all slots unchanged

**Result**: Receptionist page now uses the unified logic for base availability.

## Availability Calculation Rules (Unified)

Both pages now use the **exact same logic**:

1. **Service Duration**: ✅ Handled by shift configuration
2. **Employee Availability**: ✅ Handled by slot `employee_id` and availability
3. **Existing Bookings**: ✅ Handled by `available_capacity` and `booked_count`
4. **Slot Capacity**: ✅ Filtered by `available_capacity > 0`
5. **Shift Start & End Times**: ✅ Handled by shift `start_time_utc` and `end_time_utc`
6. **Time Zone Handling**: ✅ Handled by UTC times in database
7. **Disabled Past Time Slots**: ✅ Filtered out for today
8. **Fully Booked Slots**: ✅ Filtered out (`available_capacity = 0`)

## API & Data Flow

### Shared Logic Flow

```
Both Pages → fetchAvailableSlotsUtil() → Same Result
```

1. **Fetch Shifts**: `shifts` table filtered by `service_id` and `is_active = true`
2. **Fetch Slots**: `slots` table filtered by:
   - `tenant_id`
   - `shift_id` IN (shift IDs)
   - `slot_date` = selected date
   - `is_available = true`
   - `available_capacity > 0` (unless `includeZeroCapacity`)
3. **Fetch Locks**: `/api/bookings/locks` endpoint (POST)
4. **Filter Locked Slots**: Remove slots with active locks
5. **Filter by Days of Week**: Match slot date to shift `days_of_week`
6. **Filter Past Slots**: Remove past time slots for today
7. **Order by Time**: Sort by `start_time`

### Receptionist-Specific Addition

- **Conflict Filter**: Only applies when booking multiple services
  - Prevents overlapping time slots when booking multiple services
  - Does NOT affect single-service bookings
  - Returns all slots unchanged when `selectedServices.length === 0`

## UI Behavior Consistency

### Single Service Booking

| Behavior | Customer Page | Receptionist Page |
|----------|--------------|-------------------|
| Shows shifts | ✅ Yes | ✅ Yes |
| Shows available slots | ✅ Yes | ✅ Yes |
| Filters by capacity | ✅ Yes | ✅ Yes |
| Filters locked slots | ✅ Yes | ✅ Yes |
| Filters by days_of_week | ✅ Yes | ✅ Yes |
| Filters past slots | ✅ Yes | ✅ Yes |
| **Result** | **Identical** | **Identical** |

### Multi-Service Booking (Receptionist Only)

| Behavior | Customer Page | Receptionist Page |
|----------|--------------|-------------------|
| Base availability | ✅ Same | ✅ Same |
| Conflict filtering | ❌ N/A | ✅ Yes (prevents overlaps) |

## Code Quality

### ✅ No Duplication

- Single source of truth: `src/lib/bookingAvailability.ts`
- Both pages import and use the same function
- No duplicate logic exists

### ✅ Maintainability

- Changes to availability logic only need to be made in one place
- Both pages automatically benefit from improvements
- Consistent behavior guaranteed

### ✅ Testability

- Shared logic can be tested independently
- Both pages can be tested for consistency
- Edge cases handled in one place

## Edge Cases Handled

1. **Fully Booked Shifts**: Filtered out (`available_capacity = 0`)
2. **Partially Booked Shifts**: Shown if `available_capacity > 0`
3. **Long Service Duration**: Handled by shift configuration
4. **Back-to-Back Bookings**: Handled by capacity calculation
5. **Day with No Availability**: Returns empty array
6. **Past Time Slots**: Filtered out for today
7. **Locked Slots**: Filtered out (temporarily reserved)
8. **Invalid Shift Days**: Filtered out (slot date doesn't match shift days)

## Testing Checklist

### ✅ Code Structure
- [x] Shared utility created
- [x] Customer page uses shared utility
- [x] Receptionist page uses shared utility
- [x] No duplicate logic exists

### ⏳ Manual Testing Required
- [ ] Compare same service + same date on both pages
- [ ] Verify slots match exactly
- [ ] Test fully booked shifts
- [ ] Test partially booked shifts
- [ ] Test past time slots (today)
- [ ] Test future dates
- [ ] Test service change
- [ ] Test date change
- [ ] Test multi-service booking (receptionist)

## Files Modified

### New Files
- `src/lib/bookingAvailability.ts` - Shared availability utility

### Modified Files
- `src/pages/public/PublicBookingPage.tsx` - Uses shared utility
- `src/pages/reception/ReceptionPage.tsx` - Uses shared utility

## Next Steps

1. **Deploy to Railway**: Push changes and wait for deployment
2. **Manual Testing**: Compare both pages side-by-side
3. **Verify Edge Cases**: Test all scenarios listed above
4. **Monitor**: Check for any inconsistencies in production

## Verification

To verify the implementation:

1. **Open Customer Booking Page**:
   - Select a service
   - Select a date
   - Note available slots

2. **Open Receptionist Booking Page**:
   - Select the same service
   - Select the same date
   - Verify slots match exactly

3. **Test Edge Cases**:
   - Fully booked service
   - Past time slots (today)
   - Future dates
   - Multiple services (receptionist only)

## Conclusion

✅ **Unified availability logic implemented**
✅ **No code duplication**
✅ **Both pages use same calculation**
✅ **Consistent behavior guaranteed**

The Receptionist Booking page now calculates and displays available shifts and time slots exactly the same way as the Customer Booking page, with the only difference being the conflict filter for multi-service bookings (which doesn't affect single-service availability).
