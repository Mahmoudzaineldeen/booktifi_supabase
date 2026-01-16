#!/usr/bin/env node

/**
 * Simple OTP Test
 * 
 * Quick test to send OTP via email and WhatsApp
 */

const API_URL = 'http://localhost:3001/api';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';

async function testOTP() {
  console.log('\n🧪 Testing OTP Delivery\n');
  console.log('='.repeat(60));
  
  // Check if fetch is available
  if (typeof fetch === 'undefined') {
    console.error('❌ fetch is not available');
    console.error('   Node.js 18+ required, or install node-fetch');
    process.exit(1);
  }
  
  // Check server
  try {
    console.log('Checking server...');
    const health = await fetch('http://localhost:3001/health');
    const healthData = await health.json();
    if (!health.ok) {
      console.error('❌ Server not healthy');
      console.error('   Response:', healthData);
      process.exit(1);
    }
    console.log('✅ Server is running');
    console.log('   Status:', healthData.status);
    console.log('   Database:', healthData.database || 'connected');
    console.log('');
  } catch (error) {
    console.error('❌ Cannot connect to server');
    console.error('   Error:', error.message);
    console.error('   Please start: cd server && npm run dev');
    process.exit(1);
  }
  
  // Test 1: Email OTP
  console.log('📧 TEST 1: Email OTP to', TEST_EMAIL);
  console.log('-'.repeat(60));
  
  try {
    const emailResponse = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: TEST_EMAIL,
        method: 'email',
      }),
    });
    
    const emailData = await emailResponse.json();
    
    if (emailResponse.ok) {
      console.log('✅ Email OTP request successful');
      console.log('   Check your email for the OTP code');
      console.log('   (In dev mode, check server console)\n');
    } else {
      console.error('❌ Email OTP failed:', emailData.error);
      if (emailData.details) {
        console.error('   Details:', emailData.details);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  // Test 2: WhatsApp OTP
  console.log('📱 TEST 2: WhatsApp OTP to', TEST_PHONE);
  console.log('-'.repeat(60));
  
  try {
    const whatsappResponse = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: TEST_PHONE,
        method: 'whatsapp',
      }),
    });
    
    const whatsappData = await whatsappResponse.json();
    
    if (whatsappResponse.ok) {
      console.log('✅ WhatsApp OTP request successful');
      console.log('   Check your WhatsApp for the OTP code');
      console.log('   (In dev mode, check server console)\n');
    } else {
      console.error('❌ WhatsApp OTP failed:', whatsappData.error);
      if (whatsappData.details) {
        console.error('   Details:', whatsappData.details);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('='.repeat(60));
  console.log('\n📝 Next Steps:');
  console.log('   1. Check your email/WhatsApp for OTP codes');
  console.log('   2. Verify OTP using:');
  console.log('      node scripts/test-otp-delivery.js --otp <CODE> --method email');
  console.log('      node scripts/test-otp-delivery.js --otp <CODE> --method whatsapp');
  console.log('\n');
}

testOTP().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
