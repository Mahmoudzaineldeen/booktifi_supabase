#!/usr/bin/env node

/**
 * Create Test Accounts via API
 * 
 * Uses the API endpoints to create test accounts
 */

const API_URL = 'http://localhost:3001/api';

async function createAccount(email, password, fullName, role, tenantId, phone, username) {
  const response = await fetch(`${API_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
      role,
      tenant_id: tenantId,
      phone,
      username,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create account');
  }
  return data;
}

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to login');
  }
  return data;
}

async function createReceptionist(token, username, password, fullName, tenantId) {
  const response = await fetch(`${API_URL}/employees/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      username,
      password,
      full_name: fullName,
      role: 'receptionist',
      tenant_id: tenantId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create receptionist');
  }
  return data;
}

async function main() {
  console.log('🚀 Starting test account creation via API...\n');

  // Step 1: Login as service provider
  console.log('1️⃣  Logging in as service provider...');
  let serviceProvider;
  try {
    serviceProvider = await login('mahmoudnzaineldeen@gmail.com', '111111');
    console.log('✅ Logged in as service provider');
    console.log(`   Tenant ID: ${serviceProvider.tenant?.id}`);
    console.log(`   Tenant Slug: ${serviceProvider.tenant?.slug}\n`);
  } catch (error) {
    console.error('❌ Failed to login as service provider:', error.message);
    console.error('   Please ensure the account exists and password is correct.');
    process.exit(1);
  }

  if (!serviceProvider.tenant) {
    console.error('❌ Service provider has no tenant!');
    process.exit(1);
  }

  const tenantId = serviceProvider.tenant.id;
  const tenantSlug = serviceProvider.tenant.slug;
  const token = serviceProvider.session.access_token;

  // Step 2: Create customers
  console.log('2️⃣  Creating 100 customer accounts...');
  const customers = [];
  const customerErrors = [];

  for (let i = 1; i <= 100; i++) {
    try {
      const email = `customer${i}@test.bookati.com`;
      const phone = `+2010000000${String(i).padStart(3, '0')}`;
      const fullName = `Customer ${i}`;

      // Check if already exists by trying to login first
      try {
        await login(email, '111111');
        if (i % 10 === 0) {
          console.log(`   ⏭️  Customer ${i} already exists, skipping...`);
        }
        continue;
      } catch {
        // Doesn't exist, continue to create
      }

      const customer = await createAccount(
        email,
        '111111',
        fullName,
        'customer',
        tenantId,
        phone,
        null
      );

      customers.push(customer);

      if (i % 10 === 0) {
        console.log(`   ✅ Created ${i}/100 customers...`);
      }
    } catch (error) {
      customerErrors.push({ customer: i, error: error.message });
      if (i <= 10 || i % 10 === 0) {
        console.log(`   ❌ Failed to create customer ${i}: ${error.message}`);
      }
    }
  }

  console.log(`\n✅ Created ${customers.length}/100 customer accounts`);
  if (customerErrors.length > 0) {
    console.log(`   ⚠️  ${customerErrors.length} errors occurred\n`);
  }

  // Step 3: Create receptionists
  console.log('3️⃣  Creating 2 receptionist accounts...');
  const receptionists = [];
  const receptionistErrors = [];

  for (let i = 1; i <= 2; i++) {
    try {
      const username = `receptionist${i}`;
      const fullName = `Receptionist ${i}`;

      // Check if already exists
      try {
        await login(`${username}@test.bookati.com`, '111111');
        console.log(`   ⏭️  Receptionist ${i} already exists, skipping...`);
        continue;
      } catch {
        // Doesn't exist, continue to create
      }

      const receptionist = await createReceptionist(
        token,
        username,
        '111111',
        fullName,
        tenantId
      );

      receptionists.push(receptionist);
      console.log(`   ✅ Created receptionist ${i}: ${username}`);
    } catch (error) {
      receptionistErrors.push({ receptionist: i, error: error.message });
      console.log(`   ❌ Failed to create receptionist ${i}: ${error.message}`);
    }
  }

  console.log(`\n✅ Created ${receptionists.length}/2 receptionist accounts`);
  if (receptionistErrors.length > 0) {
    console.log(`   ⚠️  ${receptionistErrors.length} errors occurred\n`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Service Provider: mahmoudnzaineldeen@gmail.com`);
  console.log(`✅ Customers Created: ${customers.length}/100`);
  console.log(`✅ Receptionists Created: ${receptionists.length}/2`);
  console.log(`\n🔑 All accounts use password: 111111`);
  console.log(`\n📝 Test URLs:`);
  console.log(`   Service Provider: http://localhost:5173/${tenantSlug}/admin`);
  console.log(`   Receptionist: http://localhost:5173/${tenantSlug}/reception`);
  console.log(`   Customer Booking: http://localhost:5173/${tenantSlug}/book`);
  console.log(`   Customer Login: http://localhost:5173/${tenantSlug}/customer/login`);
  console.log('\n✅ Test account creation complete!\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
