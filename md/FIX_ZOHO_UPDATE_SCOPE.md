# Fix: Zoho UPDATE Scope Not Being Requested

## Problem
The OAuth consent screen shows only 4 scopes (CREATE, READ for invoices/contacts) but **UPDATE scope is missing**.

## Root Cause
The UPDATE scope is not being included in the OAuth request. This can happen if:
1. **Tenant-specific scopes in database** override the default (most likely)
2. **Zoho Developer Console** doesn't have UPDATE scope configured
3. **Environment variable** `ZOHO_SCOPE` doesn't include UPDATE

## Solution

### Step 1: Check What Scopes Are Being Requested

Check your Railway/backend logs when you click "Connect to Zoho". Look for:
```
[Zoho Routes] Requested Scopes: ...
```

**If UPDATE is missing**, proceed to Step 2.

### Step 2: Check Tenant Configuration in Database

If you have tenant-specific Zoho configuration, check the `scopes` field:

```sql
SELECT 
  tenant_id,
  scopes,
  is_active,
  client_id
FROM tenant_zoho_configs
WHERE tenant_id = 'your-tenant-id';
```

**If `scopes` is NULL or an array without UPDATE**, that's the problem.

### Step 3: Update Tenant Scopes (If Using Tenant Config)

**Option A: Update via SQL**
```sql
UPDATE tenant_zoho_configs
SET scopes = ARRAY[
  'ZohoInvoice.invoices.CREATE',
  'ZohoInvoice.invoices.READ',
  'ZohoInvoice.invoices.UPDATE',  -- ADD THIS
  'ZohoInvoice.contacts.CREATE',
  'ZohoInvoice.contacts.READ'
]
WHERE tenant_id = 'your-tenant-id';
```

**Option B: Delete Tenant Config (Use Default)**
If you don't need tenant-specific config, delete it to use defaults:
```sql
DELETE FROM tenant_zoho_configs
WHERE tenant_id = 'your-tenant-id';
```

This will make the system use the default scopes (which include UPDATE).

### Step 4: Verify Zoho Developer Console

1. Go to https://api-console.zoho.com/
2. Find your application
3. Click on it → Go to "Scopes" section
4. **Make sure `ZohoInvoice.invoices.UPDATE` is listed**
5. If not, add it and save

### Step 5: Clear Cache and Reconnect

After updating:
1. **Disconnect** from Zoho in Settings
2. **Clear tenant credentials cache** (restart backend or wait for cache to expire)
3. **Reconnect** to Zoho
4. **Check logs** for: `[Zoho Routes] Requested Scopes: ...ZohoInvoice.invoices.UPDATE...`

## Quick Fix: Use Default Scopes

If you don't have tenant-specific needs, the easiest fix is to **remove tenant-specific config** and use defaults:

```sql
-- Check if you have tenant config
SELECT * FROM tenant_zoho_configs WHERE tenant_id = 'your-tenant-id';

-- If exists and scopes don't include UPDATE, either:
-- Option 1: Update scopes
UPDATE tenant_zoho_configs
SET scopes = ARRAY[
  'ZohoInvoice.invoices.CREATE',
  'ZohoInvoice.invoices.READ',
  'ZohoInvoice.invoices.UPDATE',
  'ZohoInvoice.contacts.CREATE',
  'ZohoInvoice.contacts.READ'
]
WHERE tenant_id = 'your-tenant-id';

-- Option 2: Delete to use defaults (recommended if no custom needs)
DELETE FROM tenant_zoho_configs WHERE tenant_id = 'your-tenant-id';
```

## Verification

After reconnecting, check server logs:
```
[Zoho Routes] Requested Scopes: ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.CREATE,ZohoInvoice.contacts.READ
[Zoho Routes] ✅ UPDATE scope confirmed - payment status sync will work
```

If you see UPDATE in both "Requested Scopes" and "Granted Scopes", you're good!

## Default Scopes (If No Tenant Config)

If no tenant-specific config exists, the system uses these defaults (which include UPDATE):
- `ZohoInvoice.invoices.CREATE`
- `ZohoInvoice.invoices.READ`
- `ZohoInvoice.invoices.UPDATE` ✅
- `ZohoInvoice.contacts.CREATE`
- `ZohoInvoice.contacts.READ`
