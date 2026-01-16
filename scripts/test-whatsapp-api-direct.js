#!/usr/bin/env node

/**
 * Test WhatsApp API Directly
 * 
 * Tests the WhatsApp API call directly to see the actual response
 */

const API_URL = 'http://localhost:3001/api';
const TEST_PHONE = '+201032560826';

async function testDirect() {
  console.log('\n🧪 Testing WhatsApp API Directly\n');
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
  
  console.log('📱 Requesting OTP via WhatsApp...');
  console.log(`   Phone: ${TEST_PHONE}`);
  console.log('   Method: whatsapp\n');
  console.log('⚠️  IMPORTANT: Check server console for detailed logs!');
  console.log('   The server will show:');
  console.log('   - Phone number format used');
  console.log('   - WhatsApp API request details');
  console.log('   - API response or error\n');
  
  try {
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: TEST_PHONE,
        method: 'whatsapp',
      }),
    });
    
    const data = await response.json();
    
    console.log('📊 Response from API:');
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${response.ok ? '✅' : '❌'}`);
    
    if (response.ok) {
      console.log('   Message:', data.message || 'OTP sent');
      console.log('\n✅ Request accepted by server');
      console.log('\n📝 Check server console for:');
      console.log('   1. Phone number format (should be 201032560826)');
      console.log('   2. WhatsApp API URL and request body');
      console.log('   3. API response status and data');
      console.log('   4. Any error messages from Meta API');
    } else {
      console.log('   Error:', data.error);
      if (data.details) {
        console.log('   Details:', data.details);
      }
      console.log('\n❌ Request failed');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Check server console logs for detailed error');
    console.log('   2. Verify access token is valid (not expired)');
    console.log('   3. Check Meta Business Dashboard for message status');
    console.log('   4. Verify phone number is registered in Meta Business');
    console.log('   5. Check if WhatsApp Business Account is approved');
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testDirect().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
