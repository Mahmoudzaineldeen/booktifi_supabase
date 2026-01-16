#!/usr/bin/env node

/**
 * Check User Password Hash
 * 
 * Checks if user has password_hash and verifies it
 */

const API_URL = 'http://localhost:3001/api';

// Import bcrypt dynamically
let bcrypt;
try {
  bcrypt = await import('bcryptjs');
} catch (error) {
  console.error('❌ bcryptjs not installed. Install with: npm install bcryptjs');
  process.exit(1);
}

async function checkUserPassword() {
  // Import bcrypt if not already imported
  if (!bcrypt) {
    try {
      bcrypt = await import('bcryptjs');
    } catch (error) {
      console.error('❌ bcryptjs not installed');
      process.exit(1);
    }
  }
  console.log('🔍 Checking password for mahmoudnzaineldeen@gmail.com...\n');

  try {
    // Get user from database (using backend service role)
    const userResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,role,is_active,tenant_id,password_hash,password&where=${encodeURIComponent(JSON.stringify({ email: 'mahmoudnzaineldeen@gmail.com' }))}&limit=1`
    );

    const userData = await userResponse.json();
    console.log('User query response:', JSON.stringify(userData, null, 2));

    if (!userData.data || userData.data.length === 0) {
      console.error('❌ User not found');
      process.exit(1);
    }

    const user = userData.data[0];
    console.log('\n📋 User Details:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Active: ${user.is_active}`);
    console.log(`   Tenant ID: ${user.tenant_id}`);
    console.log(`   Has password_hash: ${user.password_hash ? '✅ YES' : '❌ NO'}`);
    console.log(`   Has password: ${user.password ? '✅ YES' : '❌ NO'}`);

    if (user.password_hash) {
      console.log(`   Password hash (first 20 chars): ${user.password_hash.substring(0, 20)}...`);
      
      // Test password
      console.log('\n🔐 Testing password "111111"...');
      const bcryptModule = bcrypt.default || bcrypt;
      const match = await bcryptModule.compare('111111', user.password_hash);
      console.log(`   Password match: ${match ? '✅ YES' : '❌ NO'}`);
      
      if (!match) {
        console.log('\n⚠️  Password does not match!');
        console.log('   The password_hash in database does not match "111111"');
        console.log('   Solution: Reset the password or update password_hash');
      }
    } else if (user.password) {
      console.log(`   Password (first 20 chars): ${user.password.substring(0, 20)}...`);
      
      // Test password
      console.log('\n🔐 Testing password "111111"...');
      const bcryptModule = bcrypt.default || bcrypt;
      const match = await bcryptModule.compare('111111', user.password);
      console.log(`   Password match: ${match ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log('\n❌ User has NO password_hash or password field!');
      console.log('   This is why login fails.');
      console.log('   Solution: Set password_hash for this user');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

checkUserPassword();
