#!/usr/bin/env node

/**
 * Setup Test Data
 * 
 * Creates test services, shifts, and generates slots for testing
 */

const API_URL = 'http://localhost:3001/api';

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

async function checkExistingServices(token, tenantId) {
  const response = await fetch(
    `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId }))}&limit=10`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );

  const data = await response.json();
  return data.data || [];
}

async function createService(token, tenantId, serviceData) {
  const response = await fetch(`${API_URL}/insert/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: serviceData,
      returning: '*',
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Failed to create service');
  }
  return result.data[0];
}

async function createShift(token, tenantId, shiftData) {
  const response = await fetch(`${API_URL}/insert/shifts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: shiftData,
      returning: '*',
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Failed to create shift');
  }
  return result.data[0];
}

async function generateSlots(token, shiftId, startDate, endDate) {
  const response = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `SELECT generate_slots_for_shift('${shiftId}'::uuid, '${startDate}'::date, '${endDate}'::date) as slots_generated`,
    }),
  });

  const result = await response.json();
  return result;
}

async function main() {
  console.log('🚀 Setting up test data...\n');

  // Login as service provider
  console.log('1️⃣  Logging in as service provider...');
  const serviceProvider = await login('mahmoudnzaineldeen@gmail.com', '111111');
  const token = serviceProvider.session.access_token;
  const tenantId = serviceProvider.tenant.id;
  const tenantSlug = serviceProvider.tenant.slug;
  console.log(`✅ Logged in. Tenant: ${serviceProvider.tenant.name} (${tenantSlug})\n`);

  // Check existing services
  console.log('2️⃣  Checking existing services...');
  const existingServices = await checkExistingServices(token, tenantId);
  console.log(`   Found ${existingServices.length} existing service(s)\n`);

  if (existingServices.length === 0) {
    console.log('3️⃣  Creating test service...');
    
    // Create a test service
    const service = await createService(token, tenantId, {
      tenant_id: tenantId,
      name: 'Test Service',
      name_ar: 'خدمة اختبار',
      description: 'A test service for booking system testing',
      description_ar: 'خدمة اختبار لنظام الحجز',
      duration_minutes: 60,
      base_price: 100.00,
      service_duration_minutes: 60,
      capacity_per_slot: 1,
      capacity_mode: 'service_based',
      service_capacity_per_slot: 10,
      is_public: true,
      is_active: true,
    });

    console.log(`✅ Created service: ${service.name} (ID: ${service.id})\n`);

    // Create a shift (Monday to Sunday, 9 AM to 5 PM)
    console.log('4️⃣  Creating test shift...');
    const shift = await createShift(token, tenantId, {
      tenant_id: tenantId,
      service_id: service.id,
      days_of_week: [0, 1, 2, 3, 4, 5, 6], // All days
      start_time_utc: '09:00:00',
      end_time_utc: '17:00:00',
      is_active: true,
    });

    console.log(`✅ Created shift (ID: ${shift.id})\n`);

    // Generate slots for the next 30 days
    console.log('5️⃣  Generating slots for next 30 days...');
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 30);
    
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Use RPC call to generate slots
    const { data: slotsResult, error: slotsError } = await fetch(
      `${API_URL}/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `SELECT generate_slots_for_shift('${shift.id}'::uuid, '${startDateStr}'::date, '${endDateStr}'::date) as slots_generated`,
        }),
      }
    ).then(r => r.json());

    if (slotsError) {
      console.log(`   ⚠️  Error generating slots: ${slotsError.message}`);
      console.log('   Slots will be generated automatically when needed.\n');
    } else {
      console.log(`✅ Generated slots for ${startDateStr} to ${endDateStr}\n`);
    }
  } else {
    console.log('✅ Services already exist. Using existing services.\n');
  }

  console.log('='.repeat(60));
  console.log('📊 TEST DATA SETUP COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Tenant: ${serviceProvider.tenant.name}`);
  console.log(`✅ Services: ${existingServices.length > 0 ? existingServices.length : 1}`);
  console.log(`\n📝 Ready for testing at: http://localhost:5173/${tenantSlug}/book\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
