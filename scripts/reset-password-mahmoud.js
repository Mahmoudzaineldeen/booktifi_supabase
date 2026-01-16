#!/usr/bin/env node

/**
 * Reset Password for mahmoudnzaineldeen@gmail.com
 * 
 * Resets password to "111111" using backend service role
 */

const API_URL = 'http://localhost:3001/api';

async function resetPassword() {
  console.log('🔧 Resetting password for mahmoudnzaineldeen@gmail.com...\n');

  try {
    // Get user ID first
    const userResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email&where=${encodeURIComponent(JSON.stringify({ email: 'mahmoudnzaineldeen@gmail.com' }))}&limit=1`
    );

    const userData = await userResponse.json();
    console.log('User query response:', JSON.stringify(userData, null, 2));
    
    // Handle different response formats
    let users = [];
    if (Array.isArray(userData)) {
      users = userData;
    } else if (Array.isArray(userData.data)) {
      users = userData.data;
    } else if (userData.data) {
      users = [userData.data];
    }
    
    if (users.length === 0) {
      console.error('❌ User not found');
      console.error('   Response:', JSON.stringify(userData, null, 2));
      process.exit(1);
    }

    const userId = users[0].id;
    console.log(`✅ Found user: ${userId}\n`);

    // Hash the new password
    const bcrypt = await import('bcryptjs');
    const bcryptModule = bcrypt.default || bcrypt;
    const hashedPassword = await bcryptModule.hash('111111', 10);
    console.log(`✅ Password hashed\n`);

    // Update password using backend (service role bypasses RLS)
    console.log('Updating password in database...');
    const updateResponse = await fetch(`${API_URL}/update/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          password_hash: hashedPassword,
        },
        where: { id: userId },
      }),
    });

    const updateData = await updateResponse.json();

    if (updateResponse.ok) {
      console.log('✅ Password reset successfully!');
      console.log('   Email: mahmoudnzaineldeen@gmail.com');
      console.log('   Password: 111111');
      console.log('\n   You can now login with these credentials.\n');
    } else {
      console.error('❌ Failed to reset password:');
      console.error('   Status:', updateResponse.status);
      console.error('   Error:', updateData.error || 'Unknown error');
      console.error('   Response:', JSON.stringify(updateData, null, 2));
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

resetPassword();
