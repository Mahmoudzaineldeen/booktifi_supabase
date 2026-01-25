# How to Run Receptionist Edit Booking Test

## Quick Start

### Option 1: With Environment Variables (PowerShell)
```powershell
$env:API_URL="https://booktifisupabase-production.up.railway.app"
$env:RECEPTIONIST_EMAIL="your-receptionist@email.com"
$env:RECEPTIONIST_PASSWORD="your-password"
npm run test:receptionist-edit
```

### Option 2: With Environment Variables (Bash/Linux/Mac)
```bash
export API_URL=https://booktifisupabase-production.up.railway.app
export RECEPTIONIST_EMAIL=your-receptionist@email.com
export RECEPTIONIST_PASSWORD=your-password
npm run test:receptionist-edit
```

### Option 3: Test Specific Booking
```powershell
$env:API_URL="https://booktifisupabase-production.up.railway.app"
$env:RECEPTIONIST_EMAIL="your-receptionist@email.com"
$env:RECEPTIONIST_PASSWORD="your-password"
$env:TEST_BOOKING_ID="specific-booking-id-here"
npm run test:receptionist-edit
```

### Option 4: Keep Test Changes (Don't Restore)
```powershell
$env:API_URL="https://booktifisupabase-production.up.railway.app"
$env:RECEPTIONIST_EMAIL="your-receptionist@email.com"
$env:RECEPTIONIST_PASSWORD="your-password"
$env:RESTORE_BOOKING="false"
npm run test:receptionist-edit
```

## What the Test Does

1. ✅ **Login** as receptionist
2. ✅ **Find** an active booking (or use provided booking ID)
3. ✅ **Edit Booking**: Updates customer name, email, visitor count, price, status, notes
4. ✅ **Verify** all edits were saved
5. ✅ **Find** available time slots for the booking's service
6. ✅ **Change Time**: Reschedules booking to a new time slot
7. ✅ **Verify** time was updated correctly
8. ✅ **Restore** original booking data (optional)

## Expected Output

```
═══════════════════════════════════════════════════════════
🧪 Receptionist Edit Booking & Change Time Test
═══════════════════════════════════════════════════════════

📡 API URL: https://booktifisupabase-production.up.railway.app/api
👤 Receptionist: receptionist@example.com
📋 Test Booking ID: Will find one

🔐 Step 1: Logging in as receptionist...
   ✅ Login successful
   Token: abc123...
   Tenant ID: tenant-123
   Role: receptionist

📋 Step 2: Finding a test booking...
   ✅ Found active booking: booking-456
   Customer: John Doe
   Status: confirmed
   Slot ID: slot-789

✏️  Step 4: Testing Edit Booking...
   ✅ Booking updated successfully
   ✅ All fields updated correctly

🕐 Step 5: Finding available slots...
   ✅ Found 15 available slots
   Selected new slot: slot-999

🔄 Step 6: Testing Change Time...
   ✅ Booking time updated successfully
   ✅ Slot ID updated correctly

═══════════════════════════════════════════════════════════
✅ All tests passed!
═══════════════════════════════════════════════════════════
```

## Troubleshooting

### Error: "Missing credentials"
**Solution**: Provide RECEPTIONIST_EMAIL and RECEPTIONIST_PASSWORD environment variables

### Error: "Login failed: Invalid credentials"
**Solution**: Check that the email and password are correct for a receptionist account

### Error: "No active bookings found"
**Solution**: 
- Create a booking first, OR
- Provide TEST_BOOKING_ID environment variable with an existing booking ID

### Error: "No available slots found"
**Solution**: 
- Ensure the service has shifts configured
- Ensure slots exist for the next 7 days
- Check that slots have available capacity

### Error: "Change time failed"
**Solution**:
- Verify the booking is not cancelled/completed
- Check the slot has available capacity
- Verify backend RPC function exists

## Test Requirements

- ✅ Backend server running (Railway or local)
- ✅ Valid receptionist account
- ✅ At least one active booking (or provide TEST_BOOKING_ID)
- ✅ Service with shifts and slots configured

---

**Last Updated**: 2026-01-25
