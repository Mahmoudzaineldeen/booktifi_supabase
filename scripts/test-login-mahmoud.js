#!/usr/bin/env node

/**
 * Test Login for mahmoudnzaineldeen@gmail.com
 * 
 * Tests login to find the problem
 */

const API_URL = 'http://localhost:3001/api';

// Ensure fetch is available (Node 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ fetch is not available. Node.js 18+ required.');
  process.exit(1);
}

async function testLogin() {
  console.log('🔍 Testing Login for mahmoudnzaineldeen@gmail.com...\n');

  // Check server first
  try {
    console.log('Checking server status...');
    const healthCheck = await fetch('http://localhost:3001/health');
    const healthData = await healthCheck.json();
    if (!healthCheck.ok) {
      console.error('❌ Server is not healthy!');
      console.error('   Response:', healthData);
      process.exit(1);
    }
    console.log('✅ Server is running');
    console.log('   Status:', healthData.status);
    console.log('   Database:', healthData.database || 'connected');
    console.log('');
  } catch (error) {
    console.error('❌ Cannot connect to server!');
    console.error('   Error:', error.message);
    console.error('   Please start the server: cd server && npm run dev');
    process.exit(1);
  }

  try {
    // Test 1: Try admin/employee login (not forCustomer)
    console.log('Test 1: Admin/Employee login (not forCustomer)...');
    const response1 = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: 'mahmoudnzaineldeen@gmail.com', 
        password: '111111' 
      }),
    });

    const data1 = await response1.json();
    console.log(`   Status: ${response1.status}`);
    console.log(`   Response:`, JSON.stringify(data1, null, 2));

    if (response1.ok) {
      console.log('   ✅ Login successful!');
      console.log(`   User ID: ${data1.user?.id}`);
      console.log(`   Role: ${data1.user?.role}`);
      console.log(`   Tenant ID: ${data1.tenant?.id}`);
      return;
    } else {
      console.log(`   ❌ Login failed: ${data1.error}`);
    }

    // Test 2: Check if user exists in database
    console.log('\nTest 2: Checking if user exists in database...');
    const checkResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,role,is_active,tenant_id&where=${encodeURIComponent(JSON.stringify({ email: 'mahmoudnzaineldeen@gmail.com' }))}&limit=1`
    );

    const checkData = await checkResponse.json();
    console.log(`   Status: ${checkResponse.status}`);
    console.log(`   User data:`, JSON.stringify(checkData, null, 2));

    if (checkData.data && checkData.data.length > 0) {
      const user = checkData.data[0];
      console.log(`   ✅ User exists:`);
      console.log(`      ID: ${user.id}`);
      console.log(`      Email: ${user.email}`);
      console.log(`      Role: ${user.role}`);
      console.log(`      Active: ${user.is_active}`);
      console.log(`      Tenant ID: ${user.tenant_id}`);
      
      if (!user.is_active) {
        console.log('\n   ⚠️  User account is INACTIVE!');
      }
      if (!user.password_hash) {
        console.log('\n   ⚠️  User has no password_hash!');
      }
    } else {
      console.log('   ❌ User not found in database');
    }

    // Test 3: Try customer login
    console.log('\nTest 3: Customer login (forCustomer: true)...');
    const response2 = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: 'mahmoudnzaineldeen@gmail.com', 
        password: '111111',
        forCustomer: true 
      }),
    });

    const data2 = await response2.json();
    console.log(`   Status: ${response2.status}`);
    console.log(`   Response:`, JSON.stringify(data2, null, 2));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testLogin();
