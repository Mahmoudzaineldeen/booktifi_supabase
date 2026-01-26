# Zoho Invoice Setup for Saudi Arabia

## Organization Location: Saudi Arabia

Saudi Arabia is typically served by the **US data center** for Zoho services.

## API Configuration

### Step 1: Verify API Base URL

For Saudi Arabia, use the **US data center**:

```env
ZOHO_API_BASE_URL=https://invoice.zoho.com/api/v3
```

This is already the default in the code, so no change needed unless you're using a different region.

### Step 2: Create Organization in Zoho Invoice

1. **Go to Zoho Invoice**
   - Visit: https://invoice.zoho.com/
   - Sign in with your Zoho account

2. **Create Organization**
   - When you first log in, you'll see a setup wizard
   - Or go to: Settings → Organization → Create Organization
   - Fill in:
     - **Organization Name**: Your business name
     - **Address**: Your Saudi Arabia address
     - **Currency**: SAR (Saudi Riyal)
     - **Timezone**: (Asia/Riyadh or GMT+3)
     - **Tax ID**: (if applicable)
     - **Phone**: Your contact number

3. **Complete Setup**
   - Follow the wizard to complete organization setup
   - Make sure the organization is active

### Step 3: Verify Organization

1. After creating the organization, you should see:
   - Organization name in the top-left corner
   - Dashboard with organization details
   - Ability to create invoices manually

2. **Test Manual Invoice Creation**
   - Try creating a test invoice manually in the web interface
   - If this works, the API should work too

### Step 4: Re-authorize (if needed)

If you created the organization **after** the OAuth flow:

1. **Delete existing tokens:**
   ```sql
   DELETE FROM zoho_tokens WHERE tenant_id = '63107b06-938e-4ce6-b0f3-520a87db397b';
   ```

2. **Re-run token exchange:**
   ```bash
   cd project/server
   node scripts/exchange-code-for-tokens.js
   ```

   Or use OAuth redirect flow:
   ```
   http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b
   ```

### Step 5: Test Invoice Creation

After organization is set up and tokens are refreshed:

```bash
cd project/server
node scripts/create-invoice-simple-api.js
```

## Currency Configuration

Make sure your Zoho Invoice organization is configured for **SAR (Saudi Riyal)**:

1. Go to Settings → Preferences → Currency
2. Set base currency to **SAR**
3. Save changes

The code already uses `currency_code: 'SAR'` in invoice creation, so this should match.

## Timezone Configuration

Recommended timezone for Saudi Arabia:
- **Asia/Riyadh** (GMT+3)
- Or **Arabian Standard Time**

Set this in:
- Zoho Invoice: Settings → Preferences → Timezone
- Your organization settings

## Troubleshooting

### Error: "This user is not associated with any organization"

**Solution:**
1. Make sure you've created an organization in Zoho Invoice
2. Verify you're logged into the correct Zoho account
3. Check that the organization is active (not suspended)

### Error: "Invalid API region"

**Solution:**
- Saudi Arabia uses the US data center: `https://invoice.zoho.com/api/v3`
- Make sure `ZOHO_API_BASE_URL` in `.env` matches (or leave as default)

### Error: "Currency mismatch"

**Solution:**
- Set organization currency to SAR in Zoho Invoice
- The code uses `currency_code: 'SAR'` which should match

## Verification Checklist

- [ ] Organization created in Zoho Invoice
- [ ] Organization currency set to SAR
- [ ] Organization timezone set to Asia/Riyadh
- [ ] Can create manual invoice in Zoho Invoice web interface
- [ ] Tokens re-authorized (if organization created after OAuth)
- [ ] API base URL is `https://invoice.zoho.com/api/v3`
- [ ] Test invoice creation script runs successfully

## Next Steps

1. **Create organization** in Zoho Invoice (if not done)
2. **Verify organization** is active and configured for SAR
3. **Re-authorize** if organization was created after initial OAuth
4. **Test invoice creation** using the script

Once the organization is set up, invoice creation should work perfectly!

