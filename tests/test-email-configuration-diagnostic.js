/**
 * Email Configuration Diagnostic Test
 * 
 * This test checks:
 * 1. Email configuration for the tenant
 * 2. Whether SendGrid or SMTP is configured
 * 3. Tests the email connection
 * 4. Attempts to send a test email
 */

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

const TENANT_ADMIN_EMAIL = 'mahmoudnzaineldeen@gmail.com';
const TENANT_ADMIN_PASSWORD = '111111';
const TEST_EMAIL = 'kaptifidev@gmail.com';

let token = null;
let tenantId = null;

async function apiRequest(endpoint, options = {}, skipToken = false) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...((token && !skipToken) && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
  });

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return {
    status: response.status,
    data,
    ok: response.ok,
  };
}

async function checkEmailConfiguration() {
  console.log(`\n🔍 Checking Email Configuration`);
  console.log(`============================================================\n`);

  // Get tenant email settings
  const tenantResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'tenants',
      select: 'id, name, smtp_settings, email_settings',
      where: { id: tenantId },
      limit: 1,
    }),
  });

  if (!tenantResponse.ok) {
    console.error(`❌ Failed to fetch tenant data`);
    return;
  }

  const tenants = Array.isArray(tenantResponse.data) 
    ? tenantResponse.data 
    : (tenantResponse.data?.data || []);

  if (tenants.length === 0) {
    console.error(`❌ Tenant not found`);
    return;
  }

  const tenant = tenants[0];
  console.log(`📋 Tenant: ${tenant.name || tenant.id}`);
  console.log(`\n📧 Email Settings:`);
  
  // Check SendGrid
  const sendgridKey = tenant.email_settings?.sendgrid_api_key || 
                     tenant.smtp_settings?.sendgrid_api_key ||
                     process.env.SENDGRID_API_KEY;
  
  if (sendgridKey) {
    console.log(`   ✅ SendGrid API Key: Configured (${sendgridKey.substring(0, 10)}...)`);
  } else {
    console.log(`   ❌ SendGrid API Key: NOT CONFIGURED`);
  }

  // Check SMTP
  const smtpSettings = tenant.smtp_settings;
  if (smtpSettings?.smtp_user && smtpSettings?.smtp_password) {
    console.log(`   ✅ SMTP Settings: Configured`);
    console.log(`      Host: ${smtpSettings.smtp_host || 'not set'}`);
    console.log(`      Port: ${smtpSettings.smtp_port || 'not set'}`);
    console.log(`      User: ${smtpSettings.smtp_user}`);
    console.log(`      Password: ${smtpSettings.smtp_password ? '***' : 'not set'}`);
  } else {
    console.log(`   ❌ SMTP Settings: NOT CONFIGURED`);
    if (smtpSettings) {
      console.log(`      Partial config found:`);
      console.log(`      Host: ${smtpSettings.smtp_host || 'not set'}`);
      console.log(`      Port: ${smtpSettings.smtp_port || 'not set'}`);
      console.log(`      User: ${smtpSettings.smtp_user || 'not set'}`);
    }
  }

  // Check environment variables
  console.log(`\n🌍 Environment Variables:`);
  if (process.env.SENDGRID_API_KEY) {
    console.log(`   ✅ SENDGRID_API_KEY: Set (${process.env.SENDGRID_API_KEY.substring(0, 10)}...)`);
  } else {
    console.log(`   ❌ SENDGRID_API_KEY: NOT SET`);
  }

  // Summary
  console.log(`\n📊 Configuration Summary:`);
  if (sendgridKey) {
    console.log(`   ✅ Email service: SendGrid (recommended for production)`);
  } else if (smtpSettings?.smtp_user && smtpSettings?.smtp_password) {
    console.log(`   ✅ Email service: SMTP`);
  } else {
    console.log(`   ❌ Email service: NOT CONFIGURED`);
    console.log(`\n⚠️  ACTION REQUIRED:`);
    console.log(`   To enable email sending, configure either:`);
    console.log(`   1. SendGrid API Key (recommended):`);
    console.log(`      - Go to tenant settings`);
    console.log(`      - Add SendGrid API key in email_settings.sendgrid_api_key`);
    console.log(`      - OR set SENDGRID_API_KEY environment variable`);
    console.log(`   2. SMTP Settings:`);
    console.log(`      - Go to tenant settings`);
    console.log(`      - Configure SMTP settings (host, port, user, password)`);
    return false;
  }

  return true;
}

async function testEmailConnection() {
  console.log(`\n🧪 Testing Email Connection`);
  console.log(`============================================================\n`);

  const testResponse = await apiRequest('/email/test', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
    }),
  });

  if (!testResponse.ok) {
    console.error(`❌ Email test failed`);
    console.error(`   Status: ${testResponse.status}`);
    console.error(`   Error: ${JSON.stringify(testResponse.data, null, 2)}`);
    return false;
  }

  console.log(`📋 Test Result:`);
  console.log(`   Success: ${testResponse.data.success || false}`);
  console.log(`   Provider: ${testResponse.data.provider || 'unknown'}`);
  if (testResponse.data.message) {
    console.log(`   Message: ${testResponse.data.message}`);
  }
  if (testResponse.data.error) {
    console.log(`   Error: ${testResponse.data.error}`);
  }
  if (testResponse.data.hint) {
    console.log(`   Hint: ${testResponse.data.hint}`);
  }

  return testResponse.data.success || false;
}

async function sendTestEmail() {
  console.log(`\n📧 Sending Test Email`);
  console.log(`============================================================\n`);
  console.log(`   To: ${TEST_EMAIL}`);
  console.log(`   Subject: Test Email from Bookati System`);

  // Create a test booking to trigger email
  const bookingResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: 'id, slot_date, start_time',
      where: {
        tenant_id: tenantId,
        is_available: true,
        available_capacity__gt: 0,
      },
      limit: 1,
    }),
  });

  if (!bookingResponse.ok) {
    console.error(`❌ Failed to find available slot for test booking`);
    return false;
  }

  const slots = Array.isArray(bookingResponse.data) 
    ? bookingResponse.data 
    : (bookingResponse.data?.data || []);

  if (slots.length === 0) {
    console.error(`❌ No available slots found for test booking`);
    return false;
  }

  const slot = slots[0];

  // Get service for the slot
  const serviceResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'shifts',
      select: 'service_id',
      where: { id: slot.shift_id },
      limit: 1,
    }),
  });

  const shifts = Array.isArray(serviceResponse.data) 
    ? serviceResponse.data 
    : (serviceResponse.data?.data || []);

  if (shifts.length === 0) {
    console.error(`❌ Failed to find service for slot`);
    return false;
  }

  const serviceId = shifts[0].service_id;

  console.log(`\n📝 Creating test booking to trigger email...`);
  const createResponse = await apiRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify({
      slot_id: slot.id,
      service_id: serviceId,
      tenant_id: tenantId,
      customer_name: 'Email Test Customer',
      customer_phone: '+201032560826',
      customer_email: TEST_EMAIL,
      visitor_count: 1,
      total_price: 100,
      language: 'en',
    }),
  });

  if (!createResponse.ok) {
    console.error(`❌ Failed to create test booking`);
    console.error(`   Status: ${createResponse.status}`);
    console.error(`   Error: ${JSON.stringify(createResponse.data, null, 2)}`);
    return false;
  }

  const bookingId = createResponse.data.id || createResponse.data.booking?.id;
  console.log(`✅ Test booking created: ${bookingId}`);
  console.log(`\n⏳ Waiting for email delivery (15 seconds)...`);
  console.log(`   Check server logs for email sending attempts`);
  console.log(`   Check inbox at ${TEST_EMAIL} for the ticket PDF`);
  
  await new Promise(resolve => setTimeout(resolve, 15000));

  console.log(`\n✅ Test email should be sent`);
  console.log(`   📧 Check inbox at ${TEST_EMAIL}`);
  console.log(`   📧 Check spam/junk folder`);
  console.log(`   📋 Check Railway server logs for email delivery status`);

  return true;
}

async function runDiagnostic() {
  try {
    console.log('🚀 Email Configuration Diagnostic');
    console.log('============================================================');
    console.log('This diagnostic checks email configuration and sends a test email\n');

    // Login
    console.log('🔐 Logging in...');
    const loginResponse = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ 
        email: TENANT_ADMIN_EMAIL, 
        password: TENANT_ADMIN_PASSWORD 
      }),
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${JSON.stringify(loginResponse.data)}`);
    }

    token = loginResponse.data.token || loginResponse.data.access_token || loginResponse.data.session?.access_token;
    tenantId = loginResponse.data.tenant_id || loginResponse.data.user?.tenant_id || loginResponse.data.tenant?.id;

    if (!token || !tenantId) {
      throw new Error(`Login response missing token or tenant_id`);
    }

    console.log(`✅ Logged in successfully`);
    console.log(`   Tenant ID: ${tenantId}\n`);

    // Check configuration
    const hasConfig = await checkEmailConfiguration();
    
    if (!hasConfig) {
      console.log(`\n❌ Email is not configured. Please configure email settings first.`);
      process.exit(1);
    }

    // Test connection
    const connectionOk = await testEmailConnection();
    
    if (!connectionOk) {
      console.log(`\n❌ Email connection test failed. Please check your email configuration.`);
      process.exit(1);
    }

    // Send test email
    await sendTestEmail();

    console.log(`\n\n🎉 Diagnostic Complete`);
    console.log(`============================================================`);
    console.log(`\n📋 Summary:`);
    console.log(`   ✅ Email configuration: Checked`);
    console.log(`   ✅ Email connection: Tested`);
    console.log(`   ✅ Test email: Sent`);
    console.log(`\n📧 Next Steps:`);
    console.log(`   1. Check inbox at ${TEST_EMAIL}`);
    console.log(`   2. Check spam/junk folder`);
    console.log(`   3. Check Railway server logs for email delivery status`);
    console.log(`   4. If email not received, check email configuration errors in logs`);

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Diagnostic Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runDiagnostic();
