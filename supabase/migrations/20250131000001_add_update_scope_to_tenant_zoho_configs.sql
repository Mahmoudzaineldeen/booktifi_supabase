/*
  # Add UPDATE scope to tenant_zoho_configs default scopes
  
  This migration updates the default scopes in tenant_zoho_configs table
  to include ZohoInvoice.invoices.UPDATE, which is required for payment
  status synchronization.
  
  It also updates any existing tenant configs that don't have UPDATE scope.
*/

-- Update default scopes for new records (via ALTER TABLE)
ALTER TABLE tenant_zoho_configs
ALTER COLUMN scopes SET DEFAULT ARRAY[
  'ZohoInvoice.invoices.CREATE',
  'ZohoInvoice.invoices.READ',
  'ZohoInvoice.invoices.UPDATE',  -- ADDED: Required for payment status sync
  'ZohoInvoice.contacts.CREATE',
  'ZohoInvoice.contacts.READ'
];

-- Update existing records that don't have UPDATE scope
UPDATE tenant_zoho_configs
SET scopes = ARRAY[
  'ZohoInvoice.invoices.CREATE',
  'ZohoInvoice.invoices.READ',
  'ZohoInvoice.invoices.UPDATE',  -- ADDED
  'ZohoInvoice.contacts.CREATE',
  'ZohoInvoice.contacts.READ'
]
WHERE 
  scopes IS NULL 
  OR NOT ('ZohoInvoice.invoices.UPDATE' = ANY(scopes));

-- Add comment
COMMENT ON COLUMN tenant_zoho_configs.scopes IS 'Zoho OAuth scopes. Must include ZohoInvoice.invoices.UPDATE for payment status sync.';
