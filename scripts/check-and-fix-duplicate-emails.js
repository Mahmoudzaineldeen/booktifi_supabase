#!/usr/bin/env node

/**
 * Check and Fix Duplicate Emails
 * 
 * This script checks for duplicate emails and optionally fixes them
 * before applying the unique constraint
 */

const API_URL = 'http://localhost:3001/api';

async function checkDuplicates() {
  console.log('🔍 Checking for duplicate emails...\n');

  try {
    // Get all users
    const response = await fetch(
      `${API_URL}/query?table=users&select=id,email,role,created_at,tenant_id&limit=1000`
    );

    const users = await response.json();
    const userArray = Array.isArray(users) ? users : (users.data || []);
    
    // Filter to only users with emails
    const usersWithEmails = userArray.filter(u => u.email && u.email.trim() !== '');

    // Group by email
    const emailMap = new Map();
    usersWithEmails.forEach(user => {
      const email = user.email.trim().toLowerCase();
      if (!emailMap.has(email)) {
        emailMap.set(email, []);
      }
      emailMap.get(email).push(user);
    });

    // Find duplicates
    const duplicates = [];
    emailMap.forEach((users, email) => {
      if (users.length > 1) {
        duplicates.push({ email, users });
      }
    });

    if (duplicates.length === 0) {
      console.log('✅ No duplicate emails found!\n');
      console.log('✅ You can now apply the unique constraint using:');
      console.log('   psql -d your_database -f database/apply_email_unique_constraint.sql');
      console.log('   Or run it in Supabase SQL Editor\n');
      return { hasDuplicates: false };
    }

    console.log(`⚠️  Found ${duplicates.length} duplicate email(s):\n`);
    
    duplicates.forEach((dup, i) => {
      console.log(`${i + 1}. Email: ${dup.email} (${dup.users.length} users)`);
      dup.users.forEach((user, j) => {
        console.log(`   ${j + 1}. ID: ${user.id}`);
        console.log(`      Role: ${user.role}`);
        console.log(`      Tenant ID: ${user.tenant_id || 'N/A'}`);
        console.log(`      Created: ${user.created_at}`);
      });
      console.log('');
    });

    return { hasDuplicates: true, duplicates };
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    return { hasDuplicates: false, error: error.message };
  }
}

async function fixDuplicates(duplicates) {
  console.log('🔧 Fixing duplicates...\n');

  for (const dup of duplicates) {
    // Sort users: prefer tenant_admin, then by created_at
    const sortedUsers = [...dup.users].sort((a, b) => {
      if (a.role === 'tenant_admin' && b.role !== 'tenant_admin') return -1;
      if (b.role === 'tenant_admin' && a.role !== 'tenant_admin') return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // Keep the first user, update others
    const usersToUpdate = sortedUsers.slice(1);

    for (let i = 0; i < usersToUpdate.length; i++) {
      const user = usersToUpdate[i];
      const newEmail = `${dup.email}_duplicate_${i + 1}_${user.id.substring(0, 8)}`;
      
      console.log(`   Updating user ${user.id} (${user.role})`);
      console.log(`   Old email: ${dup.email}`);
      console.log(`   New email: ${newEmail}`);

      const updateResponse = await fetch(`${API_URL}/update/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { email: newEmail },
          where: { id: user.id },
        }),
      });

      if (updateResponse.ok) {
        console.log(`   ✅ Updated\n`);
      } else {
        const error = await updateResponse.json();
        console.error(`   ❌ Failed: ${error.error || 'Unknown error'}\n`);
      }
    }
  }
}

async function main() {
  const fix = process.argv.includes('--fix') || process.argv.includes('--fix-duplicates');
  
  const result = await checkDuplicates();
  
  if (result.hasDuplicates && fix) {
    await fixDuplicates(result.duplicates);
    console.log('✅ Duplicates fixed! Re-running check...\n');
    await checkDuplicates();
  } else if (result.hasDuplicates) {
    console.log('\n⚠️  To fix duplicates automatically, run:');
    console.log('   node scripts/check-and-fix-duplicate-emails.js --fix\n');
  }
}

main();
