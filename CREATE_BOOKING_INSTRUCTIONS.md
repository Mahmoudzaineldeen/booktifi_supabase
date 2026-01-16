# Create Booking for kaptifidev@gmail.com

## Prerequisites

1. **Backend server must be running**
   - Open a terminal
   - Run: `cd server && npm run dev`
   - Wait for: `🚀 API Server running on http://localhost:3001`

2. **Account exists**
   - Email: `kaptifidev@gmail.com`
   - Password: `111111`

3. **Services and slots available**
   - At least one active service
   - At least one shift for that service
   - At least one available slot (can generate via admin panel)

## Quick Start

### Option 1: Using the Script (Recommended)

```bash
node scripts/create-booking-kaptifi.js
```

The script will:
1. Check if server is running
2. Login as kaptifidev@gmail.com
3. Find available service and slot
4. Create booking
5. Show booking details

### Option 2: Manual Booking via UI

1. **Start the frontend** (if not running):
   ```bash
   npm run dev:frontend
   ```

2. **Login as customer**:
   - Go to: `http://localhost:5173/{tenantSlug}/customer/login`
   - Email: `kaptifidev@gmail.com`
   - Password: `111111`

3. **Create booking**:
   - Select service
   - Select date and time
   - Enter details:
     - Name: Kaptifi Dev
     - Phone: +201032560826
     - Email: kaptifidev@gmail.com
   - Complete booking

## Expected Results

After booking creation:

1. **Booking created** in database
2. **Ticket generated** as PDF
3. **Ticket sent via Email** to: `kaptifidev@gmail.com`
4. **Ticket sent via WhatsApp** to: `+201032560826`
5. **Ticket uses tenant branding** (colors from landing page settings)

## Verify Ticket Delivery

### Check Server Logs

Look for these messages:
```
✅ Booking created successfully: <booking-id>
📧 Starting ticket generation for booking <booking-id>...
🎨 Using tenant branding colors:
   Primary: #2563eb
   Secondary: #3b82f6
📄 Generating PDF for booking <booking-id>...
✅ Step 1 Complete: PDF generated successfully
📱 Step 2 Complete: Ticket PDF sent via WhatsApp
📧 Step 3 Complete: Ticket PDF sent via Email
✅ Ticket sending process completed
```

### Check Email

- Inbox: `kaptifidev@gmail.com`
- Subject: "Your Booking Ticket"
- Attachment: PDF ticket

### Check WhatsApp

- Number: `+201032560826`
- Message: PDF document with ticket

## Troubleshooting

### Server Not Running
```
❌ ERROR: Backend server is not running!
```
**Solution**: Start server with `cd server && npm run dev`

### No Services Found
```
❌ No active services found
```
**Solution**: 
1. Login as service provider
2. Create a service
3. Create a shift for that service
4. Generate slots

### No Slots Available
```
❌ No available slots found
```
**Solution**:
1. Login as service provider
2. Go to Shifts page
3. Generate slots for the date range

### Booking Creation Failed
Check server logs for specific error message. Common issues:
- Lock expired (try again)
- Slot no longer available (select different slot)
- Invalid data (check all required fields)

## Ticket Branding

The ticket PDF will use:
- **Primary color** from tenant's landing page settings
- **Secondary color** from tenant's landing page settings
- **Default colors** if not configured:
  - Primary: `#2563eb` (blue)
  - Secondary: `#3b82f6` (light blue)

To customize colors:
1. Login as service provider
2. Go to Landing Page Builder
3. Set Primary and Secondary colors
4. Save settings
5. Create new booking to see new colors
