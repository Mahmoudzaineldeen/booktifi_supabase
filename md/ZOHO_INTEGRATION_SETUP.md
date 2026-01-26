# Zoho Invoice Receipt Integration Setup Guide

This guide explains how to set up and use the Zoho Invoice integration for automatic receipt generation.

## Overview

The Zoho integration automatically generates and sends receipts to customers via Zoho Invoice when a booking's payment status changes to `'paid'`. This includes:

- Automatic invoice creation in Zoho
- Email delivery of receipts to customers
- Retry mechanism for failed attempts
- Multi-tenant support (separate Zoho accounts per tenant)

## Prerequisites

1. Zoho Invoice account (free tier available)
2. Zoho Developer account
3. Access to Zoho API

## Step 1: Zoho Developer Account Setup

1. Go to [Zoho Developer Console](https://api-console.zoho.com/)
2. Sign in with your Zoho account
3. Click "Add Client" or "Create Client"
4. Select "Server-based Applications"
5. Fill in the details:
   - **Client Name**: Bookati Invoice Integration
   - **Homepage URL**: Your application URL (e.g., `https://yourdomain.com`)
   - **Authorized Redirect URIs**: 
     - Development: `http://localhost:3001/api/zoho/callback`
     - Production: `https://yourdomain.com/api/zoho/callback`
6. Click "Create"
7. Note down:
   - **Client ID**
   - **Client Secret**

## Step 2: Configure Environment Variables

Add the following to your `project/server/.env` file:

```env
# Zoho OAuth Configuration
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REDIRECT_URI=http://localhost:3001/api/zoho/callback
ZOHO_SCOPE=ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE

# Zoho API Base URL (use appropriate data center)
# For US: https://invoice.zoho.com/api/v3
# For EU: https://invoice.zoho.eu/api/v3
# For India: https://invoice.zoho.in/api/v3
# For Australia: https://invoice.zoho.com.au/api/v3
ZOHO_API_BASE_URL=https://invoice.zoho.com/api/v3

# Zoho Receipt Worker Interval (optional, default: 30000ms = 30 seconds)
ZOHO_WORKER_INTERVAL=30000
```

**Important**: 
- Use the correct data center URL based on your Zoho account region
- Update `ZOHO_REDIRECT_URI` for production to match your domain

## Step 3: Run Database Migrations

Run the following migrations to set up the required database tables:

```bash
# Apply migrations (method depends on your setup)
# If using Supabase CLI:
supabase migration up

# Or manually run the SQL files in order:
# 1. 20250129000000_create_zoho_tokens_table.sql
# 2. 20250129000001_create_zoho_invoice_logs_table.sql
# 3. 20250129000002_add_zoho_invoice_id_to_bookings.sql
# 4. 20250129000003_create_zoho_receipt_trigger.sql
```

## Step 4: Connect Zoho Account (OAuth Flow)

For each tenant that needs Zoho integration:

1. **Initiate OAuth Flow**:
   ```
   GET /api/zoho/auth?tenant_id=<tenant_uuid>
   ```
   
   This will redirect to Zoho's authorization page.

2. **Authorize Application**:
   - Sign in to Zoho
   - Grant permissions to the application
   - You'll be redirected back to the callback URL

3. **Verify Connection**:
   ```
   GET /api/zoho/status?tenant_id=<tenant_uuid>
   ```
   
   Should return:
   ```json
   {
     "connected": true,
     "status": "active",
     "expires_at": "2025-02-28T12:00:00Z"
   }
   ```

## Step 5: Test the Integration

### Test Invoice Creation

```bash
POST /api/zoho/test-invoice
Content-Type: application/json

{
  "tenant_id": "<tenant_uuid>",
  "booking_id": "<booking_uuid>"
}
```

### Update Payment Status (Triggers Receipt Generation)

```bash
PATCH /api/bookings/<booking_id>/payment-status
Authorization: Bearer <token>
Content-Type: application/json

{
  "payment_status": "paid"
}
```

The database trigger will automatically queue a job to generate the Zoho receipt.

## How It Works

### Automatic Receipt Generation Flow

1. **Payment Confirmation**: When `payment_status` changes to `'paid'`:
   - Database trigger fires
   - Job queued in `queue_jobs` table
   
2. **Worker Processing**: Background worker (runs every 30 seconds):
   - Fetches pending jobs
   - Maps booking data to Zoho invoice format
   - Creates invoice in Zoho
   - Sends invoice via email
   - Updates booking with invoice ID
   - Logs success/failure

3. **Retry Mechanism**: If invoice creation fails:
   - Job retried with exponential backoff
   - Max 3 retries
   - After max retries, job marked as failed

### Manual Receipt Generation

You can also manually trigger receipt generation by updating payment status:

```typescript
// Via API
PATCH /api/bookings/:id/payment-status
{ "payment_status": "paid" }

// Or directly in database (will trigger automatically)
UPDATE bookings SET payment_status = 'paid' WHERE id = '<booking_id>';
```

## API Endpoints

### OAuth & Configuration

- `GET /api/zoho/auth?tenant_id=<uuid>` - Initiate OAuth flow
- `GET /api/zoho/callback?code=...&state=...` - OAuth callback (handled automatically)
- `GET /api/zoho/status?tenant_id=<uuid>` - Check connection status
- `POST /api/zoho/disconnect` - Disconnect Zoho integration

### Testing

- `POST /api/zoho/test-invoice` - Create test invoice for a booking

### Booking Payment

- `PATCH /api/bookings/:id/payment-status` - Update payment status (triggers receipt generation)

## Monitoring & Logs

### Check Invoice Logs

```sql
SELECT 
  b.id as booking_id,
  b.customer_name,
  b.customer_email,
  zil.status,
  zil.zoho_invoice_id,
  zil.error_message,
  zil.created_at
FROM zoho_invoice_logs zil
JOIN bookings b ON zil.booking_id = b.id
WHERE zil.tenant_id = '<tenant_uuid>'
ORDER BY zil.created_at DESC;
```

### Check Queue Jobs

```sql
SELECT 
  id,
  job_type,
  status,
  payload,
  attempts,
  created_at,
  started_at,
  completed_at
FROM queue_jobs
WHERE job_type = 'zoho_receipt'
ORDER BY created_at DESC
LIMIT 20;
```

### Check Token Status

```sql
SELECT 
  tenant_id,
  expires_at,
  CASE 
    WHEN expires_at > now() THEN 'active'
    ELSE 'expired'
  END as status,
  created_at,
  updated_at
FROM zoho_tokens
WHERE tenant_id = '<tenant_uuid>';
```

## Troubleshooting

### Issue: "No Zoho token found for tenant"

**Solution**: Complete OAuth flow:
```
GET /api/zoho/auth?tenant_id=<tenant_uuid>
```

### Issue: "Token expired or invalid"

**Solution**: The system should auto-refresh tokens. If it fails:
1. Check `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` in `.env`
2. Reconnect via OAuth flow
3. Check Zoho API logs

### Issue: Receipts not being generated

**Check**:
1. Payment status is `'paid'`
2. Customer email exists and is valid
3. Zoho tokens are valid (check `/api/zoho/status`)
4. Queue jobs are being processed (check `queue_jobs` table)
5. Check `zoho_invoice_logs` for error messages

### Issue: Email not sent

**Check**:
1. Customer email is valid format
2. Zoho account has email sending enabled
3. Check Zoho invoice logs in Zoho dashboard
4. Invoice may be created but email sending failed (check logs)

## Security Considerations

1. **Environment Variables**: Never commit `.env` file
2. **Token Storage**: Tokens are stored per tenant in database
3. **RLS Policies**: Row-level security ensures tenants can only access their own tokens
4. **API Rate Limiting**: Zoho has rate limits; worker processes jobs with delays

## Production Checklist

- [ ] Zoho production credentials configured
- [ ] OAuth redirect URI updated for production domain
- [ ] Environment variables set in production server
- [ ] Database migrations applied
- [ ] Zoho accounts connected for all tenants
- [ ] Test invoice creation successful
- [ ] Monitoring and alerting configured
- [ ] Error logging reviewed

## Support

For issues or questions:
1. Check `zoho_invoice_logs` table for error details
2. Review server logs for Zoho API errors
3. Verify Zoho account status and API access
4. Check Zoho API documentation: https://www.zoho.com/invoice/api/

