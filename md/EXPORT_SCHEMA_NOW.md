# Export Database Schema - Quick Start

## Your Connection String

```
postgresql://postgres:[YOUR-PASSWORD]@db.pivmdulophbdciygvegx.supabase.co:5432/postgres
```

## Quick Export (PowerShell)

### Step 1: Get Your Password

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Go to: **Settings** → **Database**
4. Find **"Connection string"** section
5. Copy the password from the connection string

### Step 2: Run Export

**Option A: With password as parameter**
```powershell
.\database\export-schema.ps1 -Password "your-actual-password"
```

**Option B: Set environment variable first**
```powershell
$env:SUPABASE_DB_PASSWORD = "your-actual-password"
.\database\export-schema.ps1
```

**Option C: Using Node.js script**
```powershell
$env:SUPABASE_DB_PASSWORD = "your-actual-password"
node database/export-schema-with-connection.js
```

Or provide password as argument:
```powershell
node database/export-schema-with-connection.js "your-actual-password"
```

## Direct pg_dump Command

If you have pg_dump installed:

```powershell
pg_dump --schema-only --no-owner --no-acl --clean --if-exists "postgresql://postgres:YOUR-PASSWORD@db.pivmdulophbdciygvegx.supabase.co:5432/postgres" > database/complete_schema.sql
```

Replace `YOUR-PASSWORD` with your actual password.

## Output

Schema will be saved to:
```
database/complete_schema_<timestamp>.sql
```

## What Gets Exported

- ✅ All tables
- ✅ All functions
- ✅ All types/enums
- ✅ All indexes
- ✅ All triggers
- ✅ All constraints
- ✅ All sequences

## Troubleshooting

### "pg_dump not found"
Install PostgreSQL client tools:
- Download: https://www.postgresql.org/download/windows/
- Or use Supabase Dashboard method

### "Authentication failed"
- Verify password is correct
- Get fresh password from Supabase Dashboard

### "Connection refused"
- Check network connection
- Verify connection string format
- Try "Connection pooling" string instead
