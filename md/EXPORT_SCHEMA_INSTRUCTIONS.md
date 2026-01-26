# Database Schema Export Instructions

## Quick Methods

### Method 1: Supabase Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Go to: **Settings** → **Database**
4. Scroll to **"Connection string"** section
5. Copy the **"Connection pooling"** connection string
6. It looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

### Method 2: Using pg_dump (Recommended)

**Prerequisites:**
- PostgreSQL client tools installed
- Connection string from Supabase

**Steps:**

1. **Get Connection String:**
   - Supabase Dashboard → Settings → Database
   - Copy "Connection pooling" connection string

2. **Set Environment Variable:**
   ```powershell
   $env:DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
   ```

3. **Run Export:**
   ```bash
   pg_dump --schema-only --no-owner --no-acl --clean --if-exists $env:DATABASE_URL > database/complete_schema.sql
   ```

   Or use the generated script:
   ```bash
   database\export-schema.bat
   ```

### Method 3: Using SQL Queries (Manual)

1. Open Supabase SQL Editor
2. Run queries from: `database/export-schema-queries.sql`
3. Copy results for each section:
   - Tables
   - Functions
   - Types/Enums
   - Indexes
   - Triggers
   - Foreign Keys
   - Sequences

## Export Scripts Available

1. **`database/export-schema.bat`** - Windows batch script (requires DATABASE_URL)
2. **`database/export-schema-queries.sql`** - SQL queries for manual export
3. **`scripts/export-schema-simple.js`** - Node.js script with instructions

## What Gets Exported

- ✅ All tables with columns, types, constraints
- ✅ All functions (stored procedures)
- ✅ All types and enums
- ✅ All indexes
- ✅ All triggers
- ✅ All foreign key constraints
- ✅ All sequences

## Output File

Schema will be saved to:
```
database/complete_schema_<timestamp>.sql
```

## Troubleshooting

### "pg_dump not found"
- Install PostgreSQL client tools
- Download from: https://www.postgresql.org/download/

### "Connection refused"
- Check connection string is correct
- Verify password is correct
- Try "Connection pooling" string instead of "Direct connection"

### "Permission denied"
- Use service role key in connection string
- Or use connection pooling string (recommended)
