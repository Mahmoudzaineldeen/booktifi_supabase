#!/usr/bin/env node

/**
 * Apply Email Unique Constraint
 * 
 * This script:
 * 1. Checks for duplicate emails
 * 2. Optionally fixes duplicates (if fixDuplicates=true)
 * 3. Applies the unique constraint
 */

const API_URL = 'http://localhost:3001/api';

async function applyEmailUniqueConstraint(fixDuplicates = false) {
  console.log('🔍 Checking for duplicate emails...\n');

  try {
    // Step 1: Find duplicate emails
    const duplicatesResponse = await fetch(
      `${API_URL}/query?sql=${encodeURIComponent(`
        SELECT email, COUNT(*) as count, 
               array_agg(id ORDER BY created_at DESC, role) as user_ids,
               array_agg(role ORDER BY created_at DESC, role) as roles
        FROM users 
        WHERE email IS NOT NULL 
        GROUP BY email 
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `)}`
    );

    const duplicatesData = await duplicatesResponse.json();
    const duplicates = Array.isArray(duplicatesData) ? duplicatesData : (duplicatesData.data || []);

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate email(s):\n`);
      
      duplicates.forEach((dup, i) => {
        console.log(`${i + 1}. Email: ${dup.email} (${dup.count} users)`);
        console.log(`   User IDs: ${dup.user_ids.join(', ')}`);
        console.log(`   Roles: ${dup.roles.join(', ')}`);
        console.log('');
      });

      if (fixDuplicates) {
        console.log('🔧 Fixing duplicates...\n');
        
        for (const dup of duplicates) {
          // Keep the first user (most recent or tenant_admin)
          const usersToUpdate = dup.user_ids.slice(1); // All except the first
          
          for (let i = 0; i < usersToUpdate.length; i++) {
            const userId = usersToUpdate[i];
            const newEmail = `${dup.email}_duplicate_${i + 1}_${userId.substring(0, 8)}`;
            
            console.log(`   Updating user ${userId} email to: ${newEmail}`);
            
            const updateResponse = await fetch(`${API_URL}/update/users`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                data: { email: newEmail },
                where: { id: userId },
              }),
            });

            if (!updateResponse.ok) {
              const error = await updateResponse.json();
              console.error(`   ❌ Failed: ${error.error || 'Unknown error'}`);
            } else {
              console.log(`   ✅ Updated`);
            }
          }
        }
        
        console.log('\n✅ Duplicates fixed!\n');
      } else {
        console.log('⚠️  Duplicates found but not fixed.');
        console.log('   Run with fixDuplicates=true to automatically fix them.\n');
        console.log('   Or manually fix them using: database/fix_duplicate_emails.sql\n');
        return;
      }
    } else {
      console.log('✅ No duplicate emails found!\n');
    }

    // Step 2: Apply unique constraint
    console.log('🔧 Applying unique constraint on email...\n');
    
    const constraintResponse = await fetch(`${API_URL}/query?sql=${encodeURIComponent(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx 
      ON users (email) 
      WHERE email IS NOT NULL;
    `)}`);

    if (constraintResponse.ok) {
      console.log('✅ Unique constraint applied successfully!\n');
      console.log('   Email uniqueness is now enforced at the database level.');
      console.log('   New users with duplicate emails will be rejected.\n');
    } else {
      const error = await constraintResponse.json();
      console.error('❌ Failed to apply constraint:', error);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

// Check command line argument
const fixDuplicates = process.argv.includes('--fix-duplicates') || process.argv.includes('--fix');
applyEmailUniqueConstraint(fixDuplicates);
