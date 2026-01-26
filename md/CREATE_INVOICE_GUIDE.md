# Guide: Create Zoho Invoice for Booking

## Current Status

- ✅ Booking found: `29d01803-8b04-4e4d-a5af-9eba4ff49dd0`
- ✅ Customer email: `kaptifidev@gmail.com`
- ✅ Tenant ID: `63107b06-938e-4ce6-b0f3-520a87db397b`
- ❌ Zoho not connected (authorization code expired)

## Steps to Create Invoice

### Step 1: Start the Server

```bash
cd project/server
npm run dev
```

Wait for the server to start and you should see:
```
✅ Zoho credentials loaded successfully
🚀 API Server running on http://localhost:3001
```

### Step 2: Connect Zoho (OAuth Flow)

1. **Open this URL in your browser:**
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

2. **You'll be redirected to Zoho login page**
   - Sign in with your Zoho account
   - Authorize the application
   - You'll be redirected back with a success message

3. **Verify connection:**
   ```
   http://localhost:3001/api/zoho/status?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```
   Should return: `{ "connected": true, "status": "active" }`

### Step 3: Create Invoice

**Option A: Automatic (via payment status update)**

Update the booking payment status to 'paid' - this will automatically trigger invoice creation:

```bash
# Using curl (replace <auth_token> with your JWT token)
curl -X PATCH http://localhost:3001/api/bookings/29d01803-8b04-4e4d-a5af-9eba4ff49dd0/payment-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth_token>" \
  -d '{"payment_status": "paid"}'
```

**Option B: Direct API call**

```bash
curl -X POST http://localhost:3001/api/zoho/test-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "63107b06-938e-4ce6-b0f3-520a87db397b",
    "booking_id": "29d01803-8b04-4e4d-a5af-9eba4ff49dd0"
  }'
```

**Option C: Run the script**

After OAuth is complete, run:
```bash
cd project/server
node scripts/create-invoice-direct-service.js
```

## Expected Result

After successful invoice creation:
- ✅ Invoice created in Zoho
- ✅ Invoice ID stored in database
- ✅ Email sent to `kaptifidev@gmail.com`
- ✅ Invoice visible in Zoho Invoice dashboard

## Verification

Check the invoice was created:

```sql
SELECT 
  id,
  customer_name,
  customer_email,
  zoho_invoice_id,
  zoho_invoice_created_at
FROM bookings
WHERE customer_email = 'kaptifidev@gmail.com';
```

Check invoice logs:

```sql
SELECT 
  booking_id,
  zoho_invoice_id,
  status,
  error_message,
  created_at
FROM zoho_invoice_logs
WHERE booking_id = '29d01803-8b04-4e4d-a5af-9eba4ff49dd0'
ORDER BY created_at DESC;
```

## Troubleshooting

### "No Zoho tokens found"
- Complete OAuth flow (Step 2 above)

### "Authorization code expired"
- The code in `self_client.json` is expired
- Complete OAuth flow to get fresh tokens

### "Server not running"
- Start server: `cd project/server && npm run dev`

### "Invoice creation failed"
- Check Zoho API response in logs
- Verify Zoho account has invoice creation permissions
- Check if customer email is valid in Zoho

