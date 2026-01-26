# Apply SMTP Settings Migration

## Error: 500 Internal Server Error on `/api/tenants/smtp-settings`

This error occurs because the `smtp_settings` column doesn't exist in the `tenants` table yet.

## Solution: Apply Migration

### Option 1: Using psql (Recommended)

```bash
psql -U postgres -d saudi_towerdb -f project/supabase/migrations/20251203000001_add_smtp_settings_to_tenants.sql
```

### Option 2: Using Supabase Dashboard

1. Go to SQL Editor in Supabase Dashboard
2. Copy and paste the contents of `project/supabase/migrations/20251203000001_add_smtp_settings_to_tenants.sql`
3. Run the SQL

### Option 3: Manual SQL

Run this SQL in your database:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'smtp_settings'
  ) THEN
    ALTER TABLE tenants ADD COLUMN smtp_settings jsonb DEFAULT NULL;
    
    COMMENT ON COLUMN tenants.smtp_settings IS 'SMTP configuration for email sending: {smtp_host, smtp_port, smtp_user, smtp_password}';
  END IF;
END $$;
```

## After Applying Migration

1. Restart your server:
   ```bash
   cd project/server
   npm run dev
   ```

2. Try accessing the SMTP settings page again

3. The error should be resolved!

## Verify Migration

Check if the column exists:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tenants' AND column_name = 'smtp_settings';
```

If the query returns a row, the migration was successful!

