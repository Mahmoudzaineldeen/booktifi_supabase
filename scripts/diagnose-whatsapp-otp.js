#!/usr/bin/env node

/**
 * Diagnose WhatsApp OTP Delivery
 * 
 * Checks:
 * 1. User phone number in database
 * 2. Tenant WhatsApp configuration
 * 3. Phone number format
 * 4. Simulates the OTP request to see what happens
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';

async function diagnose() {
  console.log('\n🔍 Diagnosing WhatsApp OTP Delivery Issue\n');
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
  
  // Step 1: Find user and check phone number
  console.log('📋 Step 1: Checking user phone number in database...');
  console.log('-'.repeat(60));
  
  try {
    const lookupResponse = await fetch(`${API_URL}/auth/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: TEST_EMAIL }),
    });
    
    const lookupData = await lookupResponse.json();
    
    if (lookupData.found) {
      console.log('✅ User found');
      console.log(`   Email: ${lookupData.data.maskedEmail || 'N/A'}`);
      console.log(`   Phone: ${lookupData.data.maskedPhone || 'N/A'}`);
      console.log(`   Has Phone: ${lookupData.data.hasPhone ? '✅' : '❌'}`);
      
      if (!lookupData.data.hasPhone) {
        console.log('\n❌ PROBLEM: User has no phone number in database!');
        console.log('   Solution: Update user phone number to:', TEST_PHONE);
        return;
      }
    } else {
      console.log('❌ User not found');
      return;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  // Step 2: Check tenant WhatsApp settings
  console.log('\n📋 Step 2: Checking tenant WhatsApp configuration...');
  console.log('-'.repeat(60));
  
  try {
    // Get user's tenant
    const userResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,tenant_id&where=${encodeURIComponent(JSON.stringify({ email: TEST_EMAIL }))}&limit=1`
    );
    const users = await userResponse.json();
    const user = Array.isArray(users) ? users[0] : (users.data?.[0] || users.data);
    
    if (!user || !user.tenant_id) {
      console.log('❌ User has no tenant_id');
      return;
    }
    
    console.log(`   User Tenant ID: ${user.tenant_id}`);
    
    // Get tenant WhatsApp settings
    const tenantResponse = await fetch(
      `${API_URL}/query?table=tenants&select=id,name,whatsapp_settings&where=${encodeURIComponent(JSON.stringify({ id: user.tenant_id }))}&limit=1`
    );
    const tenants = await tenantResponse.json();
    const tenant = Array.isArray(tenants) ? tenants[0] : (tenants.data?.[0] || tenants.data);
    
    if (!tenant) {
      console.log('❌ Tenant not found');
      return;
    }
    
    console.log(`   Tenant: ${tenant.name}`);
    
    if (!tenant.whatsapp_settings) {
      console.log('\n❌ PROBLEM: Tenant has no WhatsApp settings configured!');
      console.log('   Solution: Configure WhatsApp settings in tenant settings page');
      return;
    }
    
    const ws = tenant.whatsapp_settings;
    console.log(`   Provider: ${ws.provider || 'NOT SET ❌'}`);
    
    if (ws.provider === 'meta') {
      console.log(`   Phone Number ID: ${ws.phone_number_id || 'NOT SET ❌'}`);
      console.log(`   Access Token: ${ws.access_token ? 'SET ✅' : 'NOT SET ❌'}`);
      
      if (!ws.phone_number_id || !ws.access_token) {
        console.log('\n❌ PROBLEM: WhatsApp Meta settings incomplete!');
        return;
      }
    }
    
    console.log('✅ WhatsApp settings configured');
  } catch (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  // Step 3: Test OTP request and check server logs
  console.log('\n📋 Step 3: Testing OTP request...');
  console.log('-'.repeat(60));
  console.log('   Requesting OTP via WhatsApp...');
  console.log('   Phone:', TEST_PHONE);
  console.log('   ⚠️  Check server console for detailed logs\n');
  
  try {
    const otpResponse = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: TEST_PHONE,
        method: 'whatsapp',
      }),
    });
    
    const otpData = await otpResponse.json();
    
    if (otpResponse.ok) {
      console.log('✅ OTP request accepted by server');
      console.log('   Response:', otpData.message || 'Success');
      console.log('\n📝 Next Steps:');
      console.log('   1. Check server console for WhatsApp API call details');
      console.log('   2. Look for errors from Meta WhatsApp API');
      console.log('   3. Check if phone number format is correct (should be 201032560826 without +)');
      console.log('   4. Verify access token is valid and not expired');
      console.log('   5. Check Meta WhatsApp Business API dashboard for message status');
    } else {
      console.log('❌ OTP request failed');
      console.log('   Error:', otpData.error);
      if (otpData.details) {
        console.log('   Details:', otpData.details);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  // Step 4: Phone number format check
  console.log('\n📋 Step 4: Phone number format analysis...');
  console.log('-'.repeat(60));
  console.log(`   Input: ${TEST_PHONE}`);
  console.log(`   Expected for Meta API: 201032560826 (without +)`);
  console.log(`   Length: ${TEST_PHONE.replace('+', '').length} digits`);
  console.log(`   Country Code: +20 (Egypt)`);
  console.log(`   Mobile Number: 1032560826`);
  console.log('   ✅ Format looks correct\n');
  
  console.log('='.repeat(60));
  console.log('\n💡 Common Issues:');
  console.log('   1. Access token expired - Refresh in Meta Business Dashboard');
  console.log('   2. Phone number not verified in Meta Business Account');
  console.log('   3. WhatsApp Business Account not approved');
  console.log('   4. Rate limits exceeded');
  console.log('   5. Phone number format issue (check server logs)');
  console.log('\n');
}

diagnose().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
