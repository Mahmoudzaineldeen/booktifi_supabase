#!/usr/bin/env node

/**
 * Reset Password for ALL users with mahmoudnzaineldeen@gmail.com
 * 
 * Resets password to "111111" for all users with this email
 */

const API_URL = 'http://localhost:3001/api';

async function resetAllPasswords() {
  console.log('🔧 Resetting password for ALL users with mahmoudnzaineldeen@gmail.com...\n');

  try {
    // Get all users with this email
    const userResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,role&where=${encodeURIComponent(JSON.stringify({ email: 'mahmoudnzaineldeen@gmail.com' }))}&limit=10`
    );

    const userData = await userResponse.json();
    const users = Array.isArray(userData) ? userData : (Array.isArray(userData.data) ? userData.data : []);
    
    console.log(`Found ${users.length} user(s) with this email:\n`);
    users.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.id} (role: ${u.role})`);
    });
    console.log('');

    // Hash the password once
    const bcrypt = await import('bcryptjs');
    const bcryptModule = bcrypt.default || bcrypt;
    const hashedPassword = await bcryptModule.hash('111111', 10);
    console.log(`✅ Password hashed\n`);

    // Update password for each user
    for (const user of users) {
      console.log(`Updating password for user ${user.id} (${user.role})...`);
      
      const updateResponse = await fetch(`${API_URL}/update/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            password_hash: hashedPassword,
          },
          where: { id: user.id },
        }),
      });

      const updateData = await updateResponse.json();

      if (updateResponse.ok) {
        console.log(`   ✅ Password updated for ${user.role} user`);
      } else {
        console.error(`   ❌ Failed: ${updateData.error || 'Unknown error'}`);
      }
    }

    console.log('\n✅ Password reset complete for all users!');
    console.log('   Email: mahmoudnzaineldeen@gmail.com');
    console.log('   Password: 111111');
    console.log('\n   You can now login with these credentials.\n');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

resetAllPasswords();
