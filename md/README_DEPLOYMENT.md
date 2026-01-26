# Database Deployment Guide

## Complete Database Setup Script

The `complete_database_setup.sql` file contains everything needed to set up your Bookati database from scratch.

## Quick Start

### For Railway/Bolt Deployment

1. **Get your database connection string:**
   ```bash
   # From Railway dashboard, copy your PostgreSQL connection string
   # Format: postgresql://user:password@host:port/database
   ```

2. **Run the SQL script:**
   ```bash
   # Option 1: Using psql command line
   psql $DATABASE_URL -f project/database/complete_database_setup.sql
   
   # Option 2: Using Railway SQL Editor
   # - Go to Railway dashboard
   # - Open your PostgreSQL service
   # - Click "Query" tab
   # - Paste the entire script
   # - Click "Run"
   ```

3. **Verify installation:**
   ```sql
   -- Check if tables were created
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public' 
   ORDER BY table_name;
   
   -- Should see: tenants, users, services, bookings, etc.
   ```

## Important Notes

### 1. Authentication System

**If using Supabase Auth:**
- The script is ready to use
- You'll need to run RLS policies migration separately
- Users table will link to `auth.users`

**If NOT using Supabase Auth:**
- Remove the foreign key constraint from users table:
  ```sql
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;
  ```
- Disable RLS or create custom policies
- Implement your own authentication system

### 2. Row Level Security (RLS)

The script enables RLS on all tables but doesn't create detailed policies.

**If using Supabase:**
- Run: `project/supabase/migrations/20251121155318_add_rls_policies.sql`

**If NOT using Supabase:**
- Option 1: Disable RLS (for development/testing)
  ```sql
  ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
  ALTER TABLE users DISABLE ROW LEVEL SECURITY;
  -- Repeat for all tables
  ```
- Option 2: Create custom policies based on your auth system

### 3. Initial Data

After running the script, you'll need to:

1. **Create a solution owner/admin user:**
   ```sql
   -- Insert admin user (adjust based on your auth system)
   INSERT INTO users (id, email, full_name, role, is_active)
   VALUES (
     gen_random_uuid(),
     'admin@example.com',
     'Admin User',
     'solution_owner',
     true
   );
   ```

2. **Create a test tenant:**
   ```sql
   INSERT INTO tenants (name, name_ar, slug, industry, is_active)
   VALUES (
     'Test Business',
     'شركة تجريبية',
     'test-business',
     'Beauty Salon',
     true
   );
   ```

3. **Configure SMTP/WhatsApp settings** through your application UI

## Database Structure

The script creates:

- **Core Tables:** tenants, users, services, slots, bookings
- **Package System:** service_packages, package_subscriptions, package_usage
- **Customer Management:** customers, reviews, testimonials
- **Integrations:** zoho_tokens, zoho_invoice_logs, tenant_zoho_configs
- **Supporting Tables:** shifts, employee_services, booking_locks, audit_logs, payments, otp_requests

## Troubleshooting

### Error: "relation auth.users does not exist"
- You're not using Supabase Auth
- Solution: Remove the foreign key constraint (see above)

### Error: "permission denied for schema public"
- Your database user doesn't have CREATE privileges
- Solution: Grant privileges or use a superuser account

### Error: "extension uuid-ossp already exists"
- This is normal - the script uses `IF NOT EXISTS`
- Safe to ignore

### Tables created but RLS policies missing
- Run the RLS policies migration separately
- Or disable RLS if not using Supabase

## Next Steps

1. ✅ Database schema created
2. ⏭️ Run RLS policies (if using Supabase)
3. ⏭️ Create admin user
4. ⏭️ Configure environment variables
5. ⏭️ Deploy backend
6. ⏭️ Deploy frontend
7. ⏭️ Test the application

## Support

If you encounter issues:
1. Check the error message carefully
2. Verify your database connection
3. Ensure you have proper permissions
4. Review the script comments for guidance
