# Zoho Organization Setup Required

## Current Error

```
Zoho API error: {"code":9017,"message":"This user is not associated with any organization."}
```

## Problem

The Zoho account that was authorized doesn't have an organization set up in Zoho Invoice. Zoho Invoice requires an organization to be created before you can create invoices.

## Solution

### Step 1: Create Zoho Invoice Organization

1. **Go to Zoho Invoice**
   - Visit: https://invoice.zoho.com/ (or your region's URL)
   - Sign in with the same Zoho account used for OAuth

2. **Create Organization**
   - If you see a setup wizard, follow it to create your organization
   - Or go to Settings → Organization → Create Organization
   - Fill in:
     - Organization Name
     - Address
     - Currency (e.g., SAR)
     - Timezone
     - Other required details

3. **Verify Organization**
   - Make sure the organization is active
   - Check that you're in the correct organization

### Step 2: Check API Region

Zoho has different data centers. Make sure you're using the correct API base URL:

- **US**: `https://invoice.zoho.com/api/v3`
- **EU**: `https://invoice.zoho.eu/api/v3`
- **India**: `https://invoice.zoho.in/api/v3`
- **Australia**: `https://invoice.zoho.com.au/api/v3`

**Check your region:**
1. When you log into Zoho Invoice, check the URL
2. Update `ZOHO_API_BASE_URL` in `.env` to match your region

### Step 3: Re-authorize (if needed)

If you created the organization after OAuth:

1. **Disconnect existing tokens:**
   ```sql
   DELETE FROM zoho_tokens WHERE tenant_id = '63107b06-938e-4ce6-b0f3-520a87db397b';
   ```

2. **Re-run OAuth flow:**
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

3. **Or exchange code again:**
   ```bash
   node scripts/exchange-code-for-tokens.js
   ```

### Step 4: Test Again

After organization is set up:

```bash
node scripts/create-invoice-simple-api.js
```

## Alternative: Use Zoho Books

If you prefer, you can use Zoho Books instead of Zoho Invoice:

1. Update scopes in `self_client.json`:
   ```json
   {
     "scope": [
       "ZohoBooks.fullaccess.all"
     ]
   }
   ```

2. Update API base URL:
   ```env
   ZOHO_API_BASE_URL=https://books.zoho.com/api/v3
   ```

3. Re-authorize and test

## Verification

To verify your organization is set up:

1. Log into Zoho Invoice web interface
2. You should see your organization name in the top-left
3. Try creating a test invoice manually
4. If that works, the API should work too

## Next Steps

Once organization is created:

1. ✅ Organization exists in Zoho Invoice
2. ✅ API region matches your account
3. ✅ Tokens are re-authorized (if needed)
4. ✅ Run: `node scripts/create-invoice-simple-api.js`

