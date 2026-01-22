/**
 * Auto-Setup Test Runner
 * Automatically logs in and fetches test data, then runs slot capacity tests
 */

import { runTests } from './test-slot-capacity-fix.js';

const API_URL = process.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';

// Test account credentials (from tests/backend/config.js)
const TEST_ACCOUNTS = {
  RECEPTIONIST: {
    email: 'receptionist@test.com',
    password: 'test123',
  },
  TENANT_ADMIN: {
    email: 'mahmoudnzaineldeen@gmail.com',
    password: '111111',
  },
};

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Login failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return data;
}

async function getTenantData(token, loginData) {
  // Extract tenant_id from login response
  const tenantId = loginData.tenant?.id || loginData.user?.tenant_id || loginData.tenant_id;

  if (!tenantId) {
    throw new Error('User has no tenant_id in login response');
  }

  // Get services for this tenant
  const servicesResponse = await fetch(`${API_URL}/query?table=services&select=id&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_active: true }))}&limit=1`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!servicesResponse.ok) {
    throw new Error(`Failed to fetch services: ${servicesResponse.statusText}`);
  }

  const servicesData = await servicesResponse.json();
  const serviceId = servicesData.data?.[0]?.id;

  if (!serviceId) {
    throw new Error('No active services found');
  }

  // Get slots for this tenant
  const slotsResponse = await fetch(`${API_URL}/query?table=slots&select=id&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_available: true }))}&limit=1`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!slotsResponse.ok) {
    throw new Error(`Failed to fetch slots: ${slotsResponse.statusText}`);
  }

  const slotsData = await slotsResponse.json();
  const slotId = slotsData.data?.[0]?.id;

  if (!slotId) {
    throw new Error('No available slots found');
  }

  return {
    tenant_id: tenantId,
    service_id: serviceId,
    slot_id: slotId,
  };
}

async function autoSetup() {
  console.log('🔧 Auto-Setting Up Test Configuration...\n');

  try {
    // Try receptionist first
    let token = null;
    let account = null;
    let loginResult = null;

    console.log('1️⃣  Attempting to login as receptionist...');
    try {
      loginResult = await login(TEST_ACCOUNTS.RECEPTIONIST.email, TEST_ACCOUNTS.RECEPTIONIST.password);
      token = loginResult.session?.access_token || loginResult.token;
      account = TEST_ACCOUNTS.RECEPTIONIST;
      console.log('✅ Logged in as receptionist\n');
    } catch (error) {
      console.log('❌ Receptionist login failed, trying tenant admin...');
      loginResult = await login(TEST_ACCOUNTS.TENANT_ADMIN.email, TEST_ACCOUNTS.TENANT_ADMIN.password);
      token = loginResult.session?.access_token || loginResult.token;
      account = TEST_ACCOUNTS.TENANT_ADMIN;
      console.log('✅ Logged in as tenant admin\n');
    }

    if (!token || !loginResult) {
      throw new Error('Failed to login with any test account');
    }

    // Get tenant data
    console.log('2️⃣  Fetching tenant, service, and slot data...');
    const tenantData = await getTenantData(token, loginResult);

    if (!tenantData || !tenantData.tenant_id) {
      throw new Error('No active tenant found');
    }

    if (!tenantData.service_id) {
      throw new Error('No active service found for tenant');
    }

    if (!tenantData.slot_id) {
      throw new Error('No available slot found for testing');
    }

    console.log('✅ Found test data:');
    console.log(`   Tenant ID: ${tenantData.tenant_id}`);
    console.log(`   Service ID: ${tenantData.service_id}`);
    console.log(`   Slot ID: ${tenantData.slot_id}\n`);

    // Set environment variables
    process.env.TEST_TENANT_ID = tenantData.tenant_id;
    process.env.TEST_SERVICE_ID = tenantData.service_id;
    process.env.TEST_SLOT_ID = tenantData.slot_id;
    process.env.TEST_RECEPTIONIST_TOKEN = token;
    process.env.TEST_TENANT_ADMIN_TOKEN = token;

    console.log('3️⃣  Running slot capacity tests...\n');
    console.log('='.repeat(60) + '\n');

    // Run the actual tests
    await runTests();

  } catch (error) {
    console.error('\n❌ Auto-setup failed:', error.message);
    console.error('\n📝 Manual Setup Required:');
    console.error('   Set these environment variables:');
    console.error('   - TEST_TENANT_ID');
    console.error('   - TEST_SERVICE_ID');
    console.error('   - TEST_SLOT_ID');
    console.error('   - TEST_RECEPTIONIST_TOKEN');
    console.error('\n   Then run: node tests/test-slot-capacity-fix.js');
    process.exit(1);
  }
}

// Run auto-setup
autoSetup();
