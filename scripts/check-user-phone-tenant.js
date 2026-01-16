#!/usr/bin/env node

/**
 * Check User Phone and Tenant
 * 
 * Verifies the user's phone number and tenant association
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';

async function checkUser() {
  console.log('\n🔍 Checking User Phone and Tenant\n');
  console.log('='.repeat(60));
  
  // Check server
  try {
    const health = await fetch('http://localhost:3001/health');
    if (!health.ok) {
      console.error('❌ Server not healthy');
      process.exit(1);
    }
    console.log('✅ Server is running\n');
  } catch (error) {
    console.error('❌ Cannot connect to server');
    process.exit(1);
  }
  
  // Find user by email
  console.log('📋 Finding user by email:', TEST_EMAIL);
  console.log('-'.repeat(60));
  
  try {
    const userResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,phone,tenant_id,role&where=${encodeURIComponent(JSON.stringify({ email: TEST_EMAIL }))}&limit=5`
    );
    
    const users = await userResponse.json();
    const userArray = Array.isArray(users) ? users : (users.data || []);
    
    if (userArray.length === 0) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`Found ${userArray.length} user(s) with this email:\n`);
    
    userArray.forEach((user, i) => {
      console.log(`User ${i + 1}:`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Phone: ${user.phone || 'NOT SET ❌'}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Tenant ID: ${user.tenant_id || 'NOT SET ❌'}`);
      
      // Check if phone matches
      if (user.phone) {
        const normalized = user.phone.replace(/\s/g, '').replace(/^\+/, '');
        const testNormalized = TEST_PHONE.replace(/\s/g, '').replace(/^\+/, '');
        const matches = normalized === testNormalized || 
                       normalized === testNormalized.replace(/^0/, '') ||
                       testNormalized === normalized.replace(/^0/, '');
        
        console.log(`   Phone Match: ${matches ? '✅ YES' : '❌ NO'}`);
        if (!matches) {
          console.log(`   Expected: ${TEST_PHONE}`);
          console.log(`   Found: ${user.phone}`);
        }
      }
      
      // Check tenant WhatsApp settings
      if (user.tenant_id) {
        console.log(`\n   Checking tenant WhatsApp settings...`);
        fetch(
          `${API_URL}/query?table=tenants&select=id,name,whatsapp_settings&where=${encodeURIComponent(JSON.stringify({ id: user.tenant_id }))}&limit=1`
        )
          .then(res => res.json())
          .then(tenants => {
            const tenant = Array.isArray(tenants) ? tenants[0] : (tenants.data?.[0] || tenants.data);
            if (tenant) {
              console.log(`   Tenant: ${tenant.name}`);
              if (tenant.whatsapp_settings) {
                const ws = tenant.whatsapp_settings;
                console.log(`   WhatsApp Provider: ${ws.provider || 'NOT SET ❌'}`);
                console.log(`   Phone Number ID: ${ws.phone_number_id || 'NOT SET ❌'}`);
                console.log(`   Access Token: ${ws.access_token ? 'SET ✅' : 'NOT SET ❌'}`);
              } else {
                console.log(`   WhatsApp Settings: NOT CONFIGURED ❌`);
              }
            }
          })
          .catch(err => console.log(`   Error checking tenant: ${err.message}`));
      }
      
      console.log('');
    });
    
    // Check by phone
    console.log('\n📋 Finding user by phone:', TEST_PHONE);
    console.log('-'.repeat(60));
    
    const phoneResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,phone,tenant_id,role&where=${encodeURIComponent(JSON.stringify({ phone: TEST_PHONE }))}&limit=5`
    );
    
    const phoneUsers = await phoneResponse.json();
    const phoneUserArray = Array.isArray(phoneUsers) ? phoneUsers : (phoneUsers.data || []);
    
    if (phoneUserArray.length === 0) {
      console.log('❌ No user found with this phone number');
      console.log('   This might be the problem!');
      console.log('   The phone number might be stored in a different format.');
    } else {
      console.log(`Found ${phoneUserArray.length} user(s) with this phone:\n`);
      phoneUserArray.forEach((user, i) => {
        console.log(`User ${i + 1}:`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Phone: ${user.phone}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Tenant ID: ${user.tenant_id || 'NOT SET ❌'}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('='.repeat(60));
  console.log('\n💡 If phone number doesn\'t match:');
  console.log('   1. Update user phone number in database');
  console.log('   2. Ensure phone is in format: +201032560826');
  console.log('   3. Re-run the OTP test');
  console.log('\n');
}

checkUser().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
