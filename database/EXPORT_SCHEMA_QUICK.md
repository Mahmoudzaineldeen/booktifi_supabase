# Quick Database Schema Export

## Fastest Method: Supabase Dashboard

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard
2. **Select your project**
3. **Settings** → **Database**
4. **Scroll to "Connection string"**
5. **Copy "Connection pooling"** string

## Export Using pg_dump

### Windows PowerShell:
```powershell
# Set connection string
$env:DATABASE_URL = "postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

# Run export script
.\database\export-schema.ps1
```

### Windows CMD:
```cmd
set DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
database\export-schema.bat
```

### Direct Command:
```bash
pg_dump --schema-only --no-owner --no-acl --clean --if-exists "your-connection-string" > database/complete_schema.sql
```

## Output

Schema will be saved to:
```
database/complete_schema_<timestamp>.sql
```

## What's Included

- ✅ All tables
- ✅ All functions
- ✅ All types/enums
- ✅ All indexes
- ✅ All triggers
- ✅ All constraints
- ✅ All sequences
