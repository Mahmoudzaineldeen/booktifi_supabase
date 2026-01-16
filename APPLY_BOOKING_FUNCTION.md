# Apply create_booking_with_lock Function

## Problem
The function `create_booking_with_lock` is missing from the database, causing booking creation to fail.

## Solution
Apply the SQL function to your Supabase database.

## Method 1: Supabase SQL Editor (Recommended)

1. Open your Supabase project dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy the entire contents of `database/create_booking_with_lock_function.sql`
6. Paste into the SQL editor
7. Click **Run** (or press Ctrl+Enter)
8. Wait for success message

## Method 2: Using psql (if you have direct database access)

```bash
# Set your database connection string
export DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Run the script
psql $DATABASE_URL -f database/create_booking_with_lock_function.sql
```

## Verification

After applying, verify the function exists:

```sql
SELECT proname, pronargs 
FROM pg_proc 
WHERE proname = 'create_booking_with_lock';
```

You should see the function with 17 parameters.

## What This Function Does

- Validates all required fields
- Validates the booking lock (if provided)
- Checks slot availability and capacity
- Creates the booking in a single transaction
- Deletes the lock after successful booking
- Returns the created booking as JSON

## Note

This function is required for the booking system to work. Without it, all booking creation attempts will fail with "function not found" error.
