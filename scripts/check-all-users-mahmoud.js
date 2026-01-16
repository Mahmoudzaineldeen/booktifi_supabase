#!/usr/bin/env node

/**
 * Check All Users with mahmoudnzaineldeen@gmail.com
 * 
 * Finds all users with this email to see if there are duplicates
 */

const API_URL = 'http://localhost:3001/api';

async function checkAllUsers() {
  console.log('🔍 Checking all users with mahmoudnzaineldeen@gmail.com...\n');

  try {
    const response = await fetch(
      `${API_URL}/query?table=users&select=id,email,role,is_active,tenant_id,password_hash&where=${encodeURIComponent(JSON.stringify({ email: 'mahmoudnzaineldeen@gmail.com' }))}&limit=10`
    );

    const data = await response.json();
    
    // Handle array or object response
    const users = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []));
    
    console.log(`Found ${users.length} user(s) with this email:\n`);
    
    users.forEach((user, i) => {
      console.log(`User ${i + 1}:`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Active: ${user.is_active}`);
      console.log(`   Tenant ID: ${user.tenant_id}`);
      console.log(`   Has password_hash: ${user.password_hash ? '✅ YES (' + user.password_hash.substring(0, 20) + '...)' : '❌ NO'}`);
      console.log('');
    });

    // Test login for tenant_admin user
    const tenantAdmin = users.find(u => u.role === 'tenant_admin');
    if (tenantAdmin) {
      console.log('Testing login for tenant_admin user...');
      const loginResponse = await fetch(`${API_URL}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: 'mahmoudnzaineldeen@gmail.com', 
          password: '111111' 
        }),
      });

      const loginData = await loginResponse.json();
      console.log(`   Status: ${loginResponse.status}`);
      if (loginResponse.ok) {
        console.log('   ✅ Login successful!');
        console.log(`   User ID: ${loginData.user?.id}`);
        console.log(`   Role: ${loginData.user?.role}`);
      } else {
        console.log(`   ❌ Login failed: ${loginData.error}`);
        
        // Check password hash
        if (tenantAdmin.password_hash) {
          const bcrypt = await import('bcryptjs');
          const bcryptModule = bcrypt.default || bcrypt;
          const match = await bcryptModule.compare('111111', tenantAdmin.password_hash);
          console.log(`   Password match test: ${match ? '✅ YES' : '❌ NO'}`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

checkAllUsers();
