# Zoho UPDATE Scope Verification Guide

## Issue
The Zoho OAuth consent screen shows:
- ✅ Scope to create invoices
- ✅ Scope to fetch invoice details
- ✅ Scope to create customers
- ✅ Scope to fetch customer details
- ❌ **MISSING: Scope to update invoices** (for payment status sync)

## Why UPDATE Scope is Missing

### Possible Causes:
1. **Tenant-specific scopes in database** - If you configured custom scopes in `tenant_zoho_configs` table, they might not include UPDATE
2. **Zoho consent screen display** - Zoho might bundle UPDATE permissions under "fetch invoice details" (READ scope)
3. **Old token** - If you're using an existing token, it was obtained before UPDATE was added

## How to Verify

### Step 1: Check Server Logs
When you click "Connect to Zoho", check the Railway/backend logs for:
```
[Zoho Routes] Requested Scopes: ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.CREATE,ZohoInvoice.contacts.READ
```

**If UPDATE is missing from this log**, the issue is in scope configuration.

### Step 2: Check Database Configuration
If you have tenant-specific Zoho configuration, check the `scopes` field:

```sql
SELECT 
  tenant_id,
  scopes,
  is_active
FROM tenant_zoho_configs
WHERE tenant_id = 'your-tenant-id';
```

**If `scopes` is NULL or doesn't include `ZohoInvoice.invoices.UPDATE`**, that's the problem.

### Step 3: Check Zoho Developer Console
1. Go to https://api-console.zoho.com/
2. Find your application
3. Check "Scopes" section
4. **Make sure `ZohoInvoice.invoices.UPDATE` is listed**

## Solution

### Option 1: Update Database Scopes (If Using Tenant Config)
If you have `tenant_zoho_configs` entry, update it:

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

### Option 2: Use Default Scopes (Recommended)
If you don't have tenant-specific config, the default scopes (which include UPDATE) will be used automatically.

### Option 3: Check Environment Variables
If `ZOHO_SCOPE` environment variable is set, make sure it includes UPDATE:

```bash
ZOHO_SCOPE=ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.CREATE,ZohoInvoice.contacts.READ
```

## Important Note About Zoho Consent Screen

**Zoho might not show UPDATE as a separate item** in the consent screen. It might be bundled with:
- "Scope to fetch invoice details" (READ) - might include UPDATE
- Or shown as a combined permission

**However**, the token response will show all granted scopes. After authorization, check server logs:
```
[Zoho Routes] Granted Scopes: ZohoInvoice.invoices.CREATE ZohoInvoice.invoices.READ ZohoInvoice.invoices.UPDATE ...
```

If UPDATE is in the granted scopes, you're good - even if it wasn't shown separately in the consent screen.

## Verification After Reconnection

After reconnecting, check the server logs for:
```
[Zoho Routes] ✅ UPDATE scope confirmed - payment status sync will work
```

If you see:
```
[Zoho Routes] ⚠️  WARNING: UPDATE scope not found in granted scopes!
```

Then UPDATE wasn't granted, and you need to:
1. Check database/tenant config scopes
2. Check Zoho Developer Console scopes
3. Reconnect again

## What Each Scope Does

| Scope | Permission | Used For |
|-------|-----------|----------|
| `ZohoInvoice.invoices.CREATE` | Create invoices | Creating invoices from bookings |
| `ZohoInvoice.invoices.READ` | Read invoices | Fetching invoice details, downloading PDFs |
| `ZohoInvoice.invoices.UPDATE` | **Update invoices** | **Updating payment status, marking as paid/void** |
| `ZohoInvoice.contacts.CREATE` | Create customers | Creating customer records in Zoho |
| `ZohoInvoice.contacts.READ` | Read customers | Finding existing customers |

**UPDATE is critical for payment status synchronization!**
