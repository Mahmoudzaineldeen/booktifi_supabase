/**
 * Quick Verification Script for Remaining Tasks
 * Tests API endpoints directly without requiring full test data setup
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

// Test accounts (update these with your actual test accounts)
const TEST_ACCOUNTS = {
  cashier: {
    email: 'cashier@test.com',
    password: 'test123'
  },
  receptionist: {
    email: 'receptionist@test.com',
    password: 'test123'
  },
  tenant_admin: {
    email: 'mahmoudnzaineldeen@gmail.com',
    password: '111111'
  }
};

let tokens = {};

async function signIn(email, password) {
  try {
    const response = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, forCustomer: false })
    });
    
    const data = await response.json();
    if (data.session?.access_token) {
      return data.session.access_token;
    }
    throw new Error(data.error || 'Sign in failed');
  } catch (error) {
    console.error(`❌ Sign in failed for ${email}:`, error.message);
    return null;
  }
}

async function testEndpoint(name, method, endpoint, body, token, expectedStatus = 200) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    });

    const data = await response.json().catch(() => ({ error: 'Invalid JSON' }));

    if (response.status === expectedStatus) {
      console.log(`✅ ${name}: Status ${response.status} (Expected ${expectedStatus})`);
      return true;
    } else {
      console.log(`❌ ${name}: Status ${response.status} (Expected ${expectedStatus})`);
      console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 200));
      return false;
    }
  } catch (error) {
    console.log(`❌ ${name}: Error - ${error.message}`);
    return false;
  }
}

async function runVerification() {
  console.log('🚀 Verifying Remaining Tasks Implementation');
  console.log('==========================================\n');

  // Sign in as all roles
  console.log('🔧 Signing in as test users...\n');
  tokens.cashier = await signIn(TEST_ACCOUNTS.cashier.email, TEST_ACCOUNTS.cashier.password);
  tokens.receptionist = await signIn(TEST_ACCOUNTS.receptionist.email, TEST_ACCOUNTS.receptionist.password);
  tokens.tenant_admin = await signIn(TEST_ACCOUNTS.tenant_admin.email, TEST_ACCOUNTS.tenant_admin.password);

  if (!tokens.tenant_admin) {
    console.error('❌ Failed to sign in as tenant admin. Cannot proceed with tests.');
    process.exit(1);
  }

  console.log('✅ Sign in complete\n');

  // TASK 5: Role-Based Access
  console.log('🧪 TASK 5: Role-Based Access Enforcement\n');
  
  // Note: These tests require actual booking IDs, so we'll test the endpoint structure
  console.log('⚠️  Note: Full tests require actual booking IDs and test data');
  console.log('   See MANUAL_TESTING_REMAINING_TASKS.md for complete testing guide\n');

  // Test that endpoints exist and return proper error messages
  await testEndpoint(
    '5.1: QR Validation endpoint exists',
    'POST',
    '/bookings/validate-qr',
    { booking_id: '00000000-0000-0000-0000-000000000000' },
    tokens.cashier,
    404 // Booking not found is expected
  );

  await testEndpoint(
    '5.2: Receptionist blocked from QR scan',
    'POST',
    '/bookings/validate-qr',
    { booking_id: '00000000-0000-0000-0000-000000000000' },
    tokens.receptionist,
    403 // Should be blocked
  );

  await testEndpoint(
    '5.3: Cashier blocked from creating bookings',
    'POST',
    '/bookings/create',
    {
      slot_id: '00000000-0000-0000-0000-000000000000',
      service_id: '00000000-0000-0000-0000-000000000000',
      tenant_id: '00000000-0000-0000-0000-000000000000',
      customer_name: 'Test',
      customer_phone: '+966501234567',
      visitor_count: 1,
      total_price: 100
    },
    tokens.cashier,
    403 // Should be blocked
  );

  // TASK 7: Invoice Access
  console.log('\n🧪 TASK 7: Invoice Access for Receptionist\n');

  await testEndpoint(
    '7.1: Invoice download endpoint exists',
    'GET',
    '/zoho/invoices/00000000-0000-0000-0000-000000000000/download',
    null,
    tokens.receptionist,
    404 // Invoice not found is expected
  );

  // TASK 8: Booking Time Editing
  console.log('\n🧪 TASK 8: Booking Time Editing\n');

  await testEndpoint(
    '8.1: Receptionist blocked from rescheduling',
    'PATCH',
    '/bookings/00000000-0000-0000-0000-000000000000',
    { slot_id: '00000000-0000-0000-0000-000000000000' },
    tokens.receptionist,
    403 // Should be blocked
  );

  console.log('\n✅ ========================================');
  console.log('✅ Endpoint Structure Verification Complete');
  console.log('✅ ========================================');
  console.log('\n📝 Next Steps:');
  console.log('   1. Create test accounts (cashier, receptionist) if needed');
  console.log('   2. Create test booking with invoice');
  console.log('   3. Follow MANUAL_TESTING_REMAINING_TASKS.md for complete testing');
  console.log('');
}

runVerification().catch(console.error);
