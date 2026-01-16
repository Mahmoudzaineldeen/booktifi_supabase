-- Fix Duplicate Emails
-- This script helps resolve duplicate emails before adding the unique constraint
--
-- Strategy: For duplicate emails, we'll:
-- 1. Keep the most recent user (or tenant_admin if exists)
-- 2. Update other users' emails to add a suffix like _old1, _old2, etc.
-- 3. Or merge users if they're truly duplicates

-- Step 1: Find all duplicate emails
DO $$
DECLARE
    dup_record RECORD;
    counter INTEGER;
    new_email TEXT;
    user_to_keep UUID;
BEGIN
    -- Loop through all duplicate emails
    FOR dup_record IN 
        SELECT email, COUNT(*) as count, array_agg(id ORDER BY created_at DESC, role) as user_ids
        FROM users 
        WHERE email IS NOT NULL 
        GROUP BY email 
        HAVING COUNT(*) > 1
    LOOP
        RAISE NOTICE 'Processing duplicate email: % (count: %)', dup_record.email, dup_record.count;
        
        -- Determine which user to keep (prefer tenant_admin, then most recent)
        SELECT id INTO user_to_keep
        FROM users
        WHERE email = dup_record.email
        ORDER BY 
            CASE role 
                WHEN 'tenant_admin' THEN 1
                WHEN 'solution_owner' THEN 2
                ELSE 3
            END,
            created_at DESC
        LIMIT 1;
        
        RAISE NOTICE 'Keeping user: %', user_to_keep;
        
        -- Update other users' emails
        counter := 1;
        FOR user_to_keep IN 
            SELECT unnest(dup_record.user_ids) as user_id
        LOOP
            IF user_to_keep != (SELECT id FROM users WHERE email = dup_record.email ORDER BY created_at DESC LIMIT 1) THEN
                new_email := dup_record.email || '_duplicate_' || counter || '_' || substr(user_to_keep::text, 1, 8);
                
                UPDATE users 
                SET email = new_email,
                    updated_at = now()
                WHERE id = user_to_keep;
                
                RAISE NOTICE 'Updated user % email to: %', user_to_keep, new_email;
                counter := counter + 1;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- Step 2: Verify no duplicates remain
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ No duplicate emails found'
        ELSE '⚠️  Still have ' || COUNT(*) || ' duplicate email(s)'
    END as status
FROM (
    SELECT email, COUNT(*) as count 
    FROM users 
    WHERE email IS NOT NULL 
    GROUP BY email 
    HAVING COUNT(*) > 1
) duplicates;
