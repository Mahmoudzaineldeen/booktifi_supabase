# Steps to Create Zoho Invoice

## Quick Start

The server should already be running in the background. Follow these steps:

### Step 1: Complete Zoho OAuth Flow

**Open this URL in your browser:**
```
http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
```

This will:
1. Redirect you to Zoho login page
2. Ask you to authorize the application
3. Redirect back with a success message
4. Store tokens in the database

### Step 2: Create the Invoice

After OAuth is complete, run:
```bash
cd project/server
node scripts/create-invoice-simple-api.js
```

This will:
- Check Zoho connection status
- Create the invoice in Zoho
- Send it to kaptifidev@gmail.com
- Update the booking with the invoice ID

---

## Alternative: Use API Directly

Once the server is running and Zoho is connected, you can also use curl:

```bash
curl -X POST http://localhost:3001/api/zoho/test-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "63107b06-938e-4ce6-b0f3-520a87db397b",
    "booking_id": "29d01803-8b04-4e4d-a5af-9eba4ff49dd0"
  }'
```

---

## Booking Details

- **Booking ID**: `29d01803-8b04-4e4d-a5af-9eba4ff49dd0`
- **Customer Email**: `kaptifidev@gmail.com`
- **Tenant ID**: `63107b06-938e-4ce6-b0f3-520a87db397b`

---

## Troubleshooting

### Server Not Running
If you get connection errors, start the server:
```bash
cd project/server
npm run dev
```

### Zoho Not Connected
If you see "Zoho is not connected", complete Step 1 (OAuth flow) first.

### Token Expired
The system will automatically refresh tokens. If you get 401 errors, complete OAuth flow again.

### Invoice Already Exists
If an invoice already exists for this booking, the script will report it and exit gracefully.

