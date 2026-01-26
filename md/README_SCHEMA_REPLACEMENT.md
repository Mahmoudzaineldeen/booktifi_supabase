# Database Schema Replacement Guide

This guide explains how to drop all existing database tables and replace them with the new schema.

## ⚠️ WARNING

**This operation will DELETE ALL DATA in your database!**

Make sure to:
1. **Backup your database** before proceeding
2. Export any important data you want to keep
3. Test this on a development/staging environment first

## Files

- `apply_new_schema.sql` - Complete SQL script that drops everything and recreates the schema
- `new_schema_dump.sql` - The new schema dump (for reference)

## Method 1: Using Supabase SQL Editor (Recommended)

### Option A: Use the Complete Script (Recommended)

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `database/apply_new_schema.sql`
5. Paste it into the SQL editor
6. Click **Run** (or press Ctrl+Enter)
7. Wait for the script to complete (may take a few minutes)

### Option B: Use the Original Dump (with manual fix)

If you want to use the original dump file:

1. **First, fix the schema creation issue:**
   - Find the line: `CREATE SCHEMA auth;`
   - Replace it with: `CREATE SCHEMA IF NOT EXISTS auth;`

2. **Remove the restrict commands:**
   - Remove the line: `\restrict 4FYzsa4S48TG9G3olygZOlY1yTogLjjybtTSQZNjbdFyjGe1NgpMs3HKH00FCKe`
   - Remove the line: `\unrestrict 4FYzsa4S48TG9G3olygZOlY1yTogLjjybtTSQZNjbdFyjGe1NgpMs3HKH00FCKe`

3. **Then run the modified dump in Supabase SQL Editor**

## Method 2: Using psql Command Line

```bash
# Set your database connection string
export DATABASE_URL="postgresql://user:password@host:port/database"

# Run the script
psql $DATABASE_URL -f database/apply_new_schema.sql
```

Or with explicit connection:

```bash
psql -h your-host -U your-user -d your-database -f database/apply_new_schema.sql
```

## Method 3: Using Node.js Script

A Node.js script is available to run the migration programmatically:

```bash
# Make sure you have DATABASE_URL in your environment
export DATABASE_URL="postgresql://user:password@host:port/database"

# Run the script
node database/run_schema_replacement.js
```

## What the Script Does

1. **Drops all triggers** (to avoid dependency issues)
2. **Drops all RLS policies** (Row Level Security policies)
3. **Drops all tables** (with CASCADE to handle dependencies)
4. **Drops all functions**
5. **Drops all custom types**
6. **Creates the new schema** including:
   - Extensions (uuid-ossp)
   - Custom types (booking_status, payment_status, user_role, capacity_mode)
   - All functions (triggers, helpers, etc.)
   - All tables with constraints
   - All indexes
   - All foreign key constraints
   - All triggers
   - Row Level Security (RLS) enabled
   - RLS policies
   - Permissions (GRANT statements)

## Verification

After running the script, verify the schema was created correctly:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Should see: audit_logs, booking_locks, bookings, customers, etc.

-- Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
ORDER BY routine_name;

-- Check indexes exist
SELECT indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY indexname;
```

## Troubleshooting

### Error: "relation already exists"
- The script uses `DROP TABLE IF EXISTS` and `CREATE TABLE`, so this shouldn't happen
- If it does, the table might have been partially created. Try running the drop section again.

### Error: "permission denied" or "must be owner of table users"
- The script skips `auth.users` table (managed by Supabase)
- If you see this error, it means the script is trying to modify Supabase-managed objects
- Make sure you're using the latest version of `apply_new_schema.sql` which handles this
- For Supabase, use the service role key or connect as the postgres user
- **Note**: The `auth.users` table is managed by Supabase and should never be dropped or recreated

### Error: "cannot drop because other objects depend on it"
- The script uses `CASCADE` when dropping tables, which should handle this
- If you still see this error, try running the drop sections in order manually

### Script takes too long
- This is normal for large databases
- The script processes everything in a transaction, so it's all-or-nothing
- Be patient and let it complete

## Next Steps

After successfully replacing the schema:

1. **Create initial data** (if needed):
   - Create a tenant
   - Create admin users
   - Set up initial services

2. **Test the application**:
   - Verify all API endpoints work
   - Test booking creation
   - Test user authentication

3. **Monitor for issues**:
   - Check application logs
   - Monitor database performance
   - Verify RLS policies are working correctly

## Rollback

If something goes wrong and you need to rollback:

1. **Restore from backup** (if you created one)
2. **Or** manually recreate the old schema using your previous migration files

## Support

If you encounter issues:
1. Check the error message carefully
2. Verify your database connection
3. Ensure you have the correct permissions
4. Review the Supabase/PostgreSQL logs
