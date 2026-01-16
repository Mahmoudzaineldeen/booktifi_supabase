#!/usr/bin/env node

/**
 * Test OTP Delivery
 * 
 * Tests sending OTP via:
 * 1. Email to mahmoudnzaineldeen@gmail.com
 * 2. WhatsApp to +2001032560826
 * 
 * Also tests OTP verification and password reset flow
 */

const API_URL = 'http://localhost:3001/api';

// Test configuration
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TEST_PHONE = '+201032560826';
const TEST_PASSWORD = '111111';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

async function checkServer() {
  logSection('🔍 Checking Server Status');
  
  try {
    const response = await fetch('http://localhost:3001/health');
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      log('✅ Server is running', 'green');
      log(`   Database: ${data.database || 'connected'}`, 'green');
      return true;
    } else {
      log('❌ Server is not healthy', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Cannot connect to server', 'red');
    log(`   Error: ${error.message}`, 'red');
    log('   Please start the server: cd server && npm run dev', 'yellow');
    return false;
  }
}

async function findUser(identifier, tenantId = null) {
  logSection(`🔍 Finding User: ${identifier}`);
  
  try {
    const body = { identifier };
    if (tenantId) body.tenant_id = tenantId;
    
    const response = await fetch(`${API_URL}/auth/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (response.ok && data.found) {
      log('✅ User found', 'green');
      log(`   Email: ${data.data.maskedEmail || 'N/A'}`, 'green');
      log(`   Phone: ${data.data.maskedPhone || 'N/A'}`, 'green');
      log(`   Has Email: ${data.data.hasEmail ? '✅' : '❌'}`, data.data.hasEmail ? 'green' : 'red');
      log(`   Has Phone: ${data.data.hasPhone ? '✅' : '❌'}`, data.data.hasPhone ? 'green' : 'red');
      return data.data;
    } else {
      log('❌ User not found', 'red');
      return null;
    }
  } catch (error) {
    log(`❌ Error finding user: ${error.message}`, 'red');
    return null;
  }
}

async function requestOTP(identifier, method, tenantId = null) {
  logSection(`📤 Requesting OTP via ${method.toUpperCase()}`);
  log(`   Identifier: ${identifier}`);
  log(`   Method: ${method}`);
  
  try {
    const body = { identifier, method };
    if (tenantId) body.tenant_id = tenantId;
    
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      log('✅ OTP request successful', 'green');
      log(`   Message: ${data.message || data.success ? 'OTP sent' : 'Check response'}`);
      
      // Check server logs for OTP (in development mode)
      log('\n   📝 Check server console for OTP code (development mode)', 'yellow');
      log('   Or check your email/WhatsApp for the OTP', 'yellow');
      
      return { success: true, data };
    } else {
      log(`❌ OTP request failed: ${data.error || 'Unknown error'}`, 'red');
      if (data.details) {
        log(`   Details: ${data.details}`, 'yellow');
      }
      return { success: false, error: data.error };
    }
  } catch (error) {
    log(`❌ Error requesting OTP: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function verifyOTP(identifier, otp, method, tenantId = null) {
  logSection(`🔐 Verifying OTP`);
  log(`   Identifier: ${identifier}`);
  log(`   OTP: ${otp}`);
  log(`   Method: ${method}`);
  
  try {
    const body = { identifier, otp, method };
    if (tenantId) body.tenant_id = tenantId;
    
    const response = await fetch(`${API_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('✅ OTP verified successfully', 'green');
      if (data.resetToken) {
        log('   Reset token received', 'green');
      }
      if (data.session) {
        log('   Session token received', 'green');
        log(`   User ID: ${data.user?.id || 'N/A'}`, 'green');
      }
      return { success: true, data };
    } else {
      log(`❌ OTP verification failed: ${data.error || 'Unknown error'}`, 'red');
      return { success: false, error: data.error };
    }
  } catch (error) {
    log(`❌ Error verifying OTP: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function resetPassword(resetToken, newPassword) {
  logSection(`🔑 Resetting Password`);
  log(`   New Password: ${newPassword}`);
  
  try {
    const response = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetToken, newPassword }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('✅ Password reset successfully', 'green');
      return { success: true };
    } else {
      log(`❌ Password reset failed: ${data.error || 'Unknown error'}`, 'red');
      return { success: false, error: data.error };
    }
  } catch (error) {
    log(`❌ Error resetting password: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function testEmailOTP() {
  logSection('📧 TEST 1: Email OTP Flow');
  
  // Step 1: Find user
  const userData = await findUser(TEST_EMAIL);
  if (!userData || !userData.hasEmail) {
    log('⚠️  Skipping email OTP test - user not found or no email', 'yellow');
    return { success: false, reason: 'User not found or no email' };
  }
  
  // Step 2: Request OTP via email
  const otpRequest = await requestOTP(TEST_EMAIL, 'email');
  if (!otpRequest.success) {
    return { success: false, error: otpRequest.error };
  }
  
  // Step 3: Wait for user to check email and provide OTP
  log('\n⏳ Waiting for OTP from email...', 'yellow');
  log('   Please check your email and enter the OTP code:', 'yellow');
  log('   (In development mode, check server console for OTP)', 'yellow');
  
  // For automated testing, we would need to read from email/console
  // For now, we'll just verify the request was successful
  return { success: true, message: 'OTP request sent. Check email for OTP code.' };
}

async function testWhatsAppOTP() {
  logSection('📱 TEST 2: WhatsApp OTP Flow');
  
  // Step 1: Find user by phone
  const userData = await findUser(TEST_PHONE);
  if (!userData || !userData.hasPhone) {
    log('⚠️  Skipping WhatsApp OTP test - user not found or no phone', 'yellow');
    return { success: false, reason: 'User not found or no phone' };
  }
  
  // Step 2: Request OTP via WhatsApp
  const otpRequest = await requestOTP(TEST_PHONE, 'whatsapp');
  if (!otpRequest.success) {
    return { success: false, error: otpRequest.error };
  }
  
  // Step 3: Wait for user to check WhatsApp and provide OTP
  log('\n⏳ Waiting for OTP from WhatsApp...', 'yellow');
  log('   Please check your WhatsApp and enter the OTP code:', 'yellow');
  log('   (In development mode, check server console for OTP)', 'yellow');
  
  return { success: true, message: 'OTP request sent. Check WhatsApp for OTP code.' };
}

async function testCompleteFlow(identifier, method, otpCode) {
  logSection(`🔄 TEST 3: Complete OTP Flow (${method.toUpperCase()})`);
  
  if (!otpCode) {
    log('⚠️  No OTP code provided. Skipping complete flow test.', 'yellow');
    log('   To test complete flow, provide OTP code as argument:', 'yellow');
    log('   node scripts/test-otp-delivery.js --otp <CODE> --method <email|whatsapp>', 'yellow');
    return { success: false, reason: 'No OTP code provided' };
  }
  
  // Step 1: Verify OTP
  const verifyResult = await verifyOTP(identifier, otpCode, method);
  if (!verifyResult.success) {
    return { success: false, error: verifyResult.error };
  }
  
  // Step 2: Reset password (if resetToken provided)
  if (verifyResult.data.resetToken) {
    const resetResult = await resetPassword(verifyResult.data.resetToken, TEST_PASSWORD);
    if (!resetResult.success) {
      return { success: false, error: resetResult.error };
    }
  }
  
  return { success: true, message: 'Complete flow tested successfully' };
}

async function main() {
  console.log('\n');
  log('🧪 OTP Delivery Test Suite', 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Ensure fetch is available
  if (typeof fetch === 'undefined') {
    log('❌ fetch is not available. Node.js 18+ required.', 'red');
    process.exit(1);
  }
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const otpCode = args.find(arg => arg.startsWith('--otp='))?.split('=')[1] || 
                  args[args.indexOf('--otp') + 1];
  const method = args.find(arg => arg.startsWith('--method='))?.split('=')[1] || 
                 args[args.indexOf('--method') + 1] || 'email';
  const skipEmail = args.includes('--skip-email');
  const skipWhatsApp = args.includes('--skip-whatsapp');
  
  // Check server
  const serverOk = await checkServer();
  if (!serverOk) {
    process.exit(1);
  }
  
  const results = {
    email: null,
    whatsapp: null,
    complete: null,
  };
  
  // Test Email OTP
  if (!skipEmail) {
    results.email = await testEmailOTP();
  } else {
    log('⏭️  Skipping email OTP test (--skip-email)', 'yellow');
  }
  
  // Test WhatsApp OTP
  if (!skipWhatsApp) {
    results.whatsapp = await testWhatsAppOTP();
  } else {
    log('⏭️  Skipping WhatsApp OTP test (--skip-whatsapp)', 'yellow');
  }
  
  // Test complete flow if OTP code provided
  if (otpCode) {
    const identifier = method === 'whatsapp' ? TEST_PHONE : TEST_EMAIL;
    results.complete = await testCompleteFlow(identifier, method, otpCode);
  }
  
  // Summary
  logSection('📊 Test Summary');
  
  if (results.email !== null) {
    log(`Email OTP: ${results.email.success ? '✅ PASSED' : '❌ FAILED'}`, 
        results.email.success ? 'green' : 'red');
    if (results.email.error) {
      log(`   Error: ${results.email.error}`, 'red');
    }
  }
  
  if (results.whatsapp !== null) {
    log(`WhatsApp OTP: ${results.whatsapp.success ? '✅ PASSED' : '❌ FAILED'}`, 
        results.whatsapp.success ? 'green' : 'red');
    if (results.whatsapp.error) {
      log(`   Error: ${results.whatsapp.error}`, 'red');
    }
  }
  
  if (results.complete !== null) {
    log(`Complete Flow: ${results.complete.success ? '✅ PASSED' : '❌ FAILED'}`, 
        results.complete.success ? 'green' : 'red');
    if (results.complete.error) {
      log(`   Error: ${results.complete.error}`, 'red');
    }
  }
  
  log('\n📝 Usage Examples:', 'cyan');
  log('   # Test email OTP only:', 'yellow');
  log('   node scripts/test-otp-delivery.js --skip-whatsapp', 'yellow');
  log('   # Test WhatsApp OTP only:', 'yellow');
  log('   node scripts/test-otp-delivery.js --skip-email', 'yellow');
  log('   # Test complete flow with OTP code:', 'yellow');
  log('   node scripts/test-otp-delivery.js --otp 123456 --method email', 'yellow');
  log('   node scripts/test-otp-delivery.js --otp 123456 --method whatsapp', 'yellow');
  
  console.log('\n');
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
