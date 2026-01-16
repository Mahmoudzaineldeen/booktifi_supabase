# Email Unique Constraint

## Problem
Multiple users can have the same email address, which causes login issues because the system doesn't know which user to authenticate.

## Solution
A unique constraint has been added to the `email` column in the `users` table to prevent duplicate emails.

## Implementation

### 1. Database Constraint
A unique index has been created on the `email` column:
```sql
CREATE UNIQUE INDEX users_email_unique_idx 
ON users (email) 
WHERE email IS NOT NULL;
```

This allows NULL emails (for users who only have username/phone) but enforces uniqueness for non-null emails.

### 2. Application-Level Checks
The following endpoints now check for duplicate emails before creating users:
- `/api/auth/signup` - User registration
- `/api/employees/create` - Employee creation

These endpoints will return a clear error message if a duplicate email is detected.

### 3. Error Handling
When a unique constraint violation occurs, the application returns user-friendly error messages:
- "An account with this email already exists" (signup)
- "Email already exists" (employee creation)

## Files Modified

1. **Database Schema**
   - `database/complete_database_setup.sql` - Added unique index creation
   - `database/apply_email_unique_constraint.sql` - Migration script

2. **Application Code**
   - `server/src/routes/auth.ts` - Added email uniqueness check in signup
   - `server/src/routes/employees.ts` - Added email uniqueness check in employee creation
   - `server/src/routes/auth.ts` - Updated login to handle multiple users (backward compatibility)

3. **Scripts**
   - `scripts/check-and-fix-duplicate-emails.js` - Check and fix duplicate emails
   - `database/fix_duplicate_emails.sql` - SQL script to fix duplicates

## Applying the Constraint

### Option 1: Run the SQL Migration
```bash
psql -d your_database -f database/apply_email_unique_constraint.sql
```

Or run it in Supabase SQL Editor.

### Option 2: Use the Script
```bash
# Check for duplicates
node scripts/check-and-fix-duplicate-emails.js

# Fix duplicates automatically
node scripts/check-and-fix-duplicate-emails.js --fix

# Then apply the constraint using Option 1
```

## Notes

- The constraint allows NULL emails, so users can still be created with only username/phone
- Existing duplicate emails should be fixed before applying the constraint
- The login logic has been updated to handle multiple users gracefully (selects the appropriate user based on role)
- New user registrations will be rejected if the email already exists
