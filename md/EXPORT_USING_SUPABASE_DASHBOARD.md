# Export Schema Using Supabase Dashboard

## Quick Method (No pg_dump Required)

Since `pg_dump` is not installed, use Supabase Dashboard:

### Step 1: Open Supabase SQL Editor

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Click **"SQL Editor"** in the left sidebar
4. Click **"New Query"**

### Step 2: Run Export Queries

Open `database/export-complete-schema.sql` and run each section:

1. **Tables** - Run query #1, copy all results
2. **Functions** - Run query #2, copy all results  
3. **Types/Enums** - Run query #3, copy all results
4. **Indexes** - Run query #4, copy all results
5. **Triggers** - Run query #5, copy all results
6. **Foreign Keys** - Run query #6, copy all results
7. **Sequences** - Run query #7, copy all results

### Step 3: Combine Results

Create a new file `database/complete_schema_export.sql` and paste all the results in order.

## Alternative: Install pg_dump

If you want to use `pg_dump`:

1. **Download PostgreSQL:**
   - https://www.postgresql.org/download/windows/
   - Install PostgreSQL (includes pg_dump)

2. **Run export:**
   ```powershell
   cd database
   .\export-schema-direct.ps1
   ```

## Connection String (for reference)

```
postgresql://postgres:Z@in11/11/200@db.pivmdulophbdciygvegx.supabase.co:5432/postgres
```

⚠️ **Security Note**: Don't commit files with passwords to git!
