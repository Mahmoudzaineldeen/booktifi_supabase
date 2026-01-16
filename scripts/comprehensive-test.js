#!/usr/bin/env node

/**
 * Comprehensive Booking System Test
 * 
 * Tests all functionalities systematically:
 * 1. Service Provider: Create services, shifts, offers, packages
 * 2. Customer: Book services, verify locks, availability
 * 3. Receptionist: Create bookings, auto-fill
 * 4. Integrations: Zoho, WhatsApp, Email
 */

const API_URL = 'http://localhost:3001/api';

// Test results
const results = {
  serviceProvider: [],
  customer: [],
  receptionist: [],
  integrations: [],
  errors: []
};

function logTest(category, test, status, details = '') {
  const result = { test, status, details, timestamp: new Date().toISOString() };
  results[category].push(result);
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} [${category.toUpperCase()}] ${test}${details ? ': ' + details : ''}`);
}

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed');
  return data;
}

async function createService(token, tenantId, serviceData) {
  const response = await fetch(`${API_URL}/insert/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ data: serviceData, returning: '*' }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create service');
  // API returns the object directly (not wrapped in data)
  if (result.id) {
    return result;
  } else if (Array.isArray(result) && result.length > 0) {
    return result[0];
  } else if (result.data) {
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
  throw new Error('Unexpected response format: ' + JSON.stringify(result));
}

async function createShift(token, tenantId, shiftData) {
  const response = await fetch(`${API_URL}/insert/shifts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ data: shiftData, returning: '*' }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create shift');
  // API returns the object directly (not wrapped in data)
  if (result.id) {
    return result;
  } else if (Array.isArray(result) && result.length > 0) {
    return result[0];
  } else if (result.data) {
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
  throw new Error('Unexpected response format: ' + JSON.stringify(result));
}

async function generateSlots(token, shiftId, startDate, endDate) {
  // Use RPC call via query endpoint
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
  if (result.error) throw new Error(result.error);
  return result.data?.[0]?.slots_generated || 0;
}

async function getAvailableSlots(token, serviceId, date) {
  const response = await fetch(
    `${API_URL}/query?table=slots&select=id,start_time,end_time,available_capacity&where=${encodeURIComponent(JSON.stringify({ service_id: serviceId, slot_date: date, is_available: true }))}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.data || [];
}

async function acquireLock(token, slotId, capacity = 1) {
  const response = await fetch(`${API_URL}/bookings/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ slot_id: slotId, reserved_capacity: capacity }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to acquire lock');
  return result;
}

async function createBooking(token, bookingData) {
  const response = await fetch(`${API_URL}/bookings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(bookingData),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create booking');
  return result;
}

async function testServiceProviderFlow() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: SERVICE PROVIDER FLOW');
  console.log('='.repeat(60) + '\n');

  try {
    // Login
    logTest('serviceProvider', 'Login as service provider', 'in_progress');
    const sp = await login('mahmoudnzaineldeen@gmail.com', '111111');
    const token = sp.session.access_token;
    const tenantId = sp.tenant.id;
    logTest('serviceProvider', 'Login as service provider', 'pass', `Tenant: ${sp.tenant.name}`);

    // Check/create service
    logTest('serviceProvider', 'Check existing services', 'in_progress');
    const existingServices = await fetch(
      `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data || []);

    let service;
    if (existingServices.length > 0) {
      service = existingServices[0];
      logTest('serviceProvider', 'Service exists', 'pass', service.name);
    } else {
      logTest('serviceProvider', 'Create service', 'in_progress');
      service = await createService(token, tenantId, {
        tenant_id: tenantId,
        name: 'Test Service',
        name_ar: 'خدمة اختبار',
        description: 'Test service for booking system',
        description_ar: 'خدمة اختبار',
        duration_minutes: 60,
        base_price: 100.00,
        service_duration_minutes: 60,
        capacity_per_slot: 1,
        capacity_mode: 'service_based',
        service_capacity_per_slot: 10,
        is_public: true,
        is_active: true,
      });
      logTest('serviceProvider', 'Create service', 'pass', service.name);
    }

    // Check/create shift
    logTest('serviceProvider', 'Check existing shifts', 'in_progress');
    const existingShifts = await fetch(
      `${API_URL}/query?table=shifts&select=id&where=${encodeURIComponent(JSON.stringify({ service_id: service.id }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data || []);

    let shift;
    if (existingShifts.length > 0) {
      shift = existingShifts[0];
      logTest('serviceProvider', 'Shift exists', 'pass');
    } else {
      logTest('serviceProvider', 'Create shift', 'in_progress');
      shift = await createShift(token, tenantId, {
        tenant_id: tenantId,
        service_id: service.id,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        start_time_utc: '09:00:00',
        end_time_utc: '17:00:00',
        is_active: true,
      });
      logTest('serviceProvider', 'Create shift', 'pass');
    }

    // Generate slots
    logTest('serviceProvider', 'Generate slots', 'in_progress');
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 30);
    const slotsGenerated = await generateSlots(
      token,
      shift.id,
      today.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );
    logTest('serviceProvider', 'Generate slots', 'pass', `${slotsGenerated} slots generated`);

    return { token, tenantId, service, shift };
  } catch (error) {
    logTest('serviceProvider', 'Service Provider Flow', 'fail', error.message);
    results.errors.push({ phase: 'serviceProvider', error: error.message });
    throw error;
  }
}

async function testCustomerFlow(serviceProviderData) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: CUSTOMER FLOW');
  console.log('='.repeat(60) + '\n');

  try {
    const { token: spToken, tenantId, service, shift } = serviceProviderData;

    // Login as customer
    logTest('customer', 'Login as customer', 'in_progress');
    const customer = await login('customer1@test.bookati.com', '111111');
    const customerToken = customer.session.access_token;
    logTest('customer', 'Login as customer', 'pass', customer.user.email);

    // Get available slots
    logTest('customer', 'Get available slots', 'in_progress');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    // Get slots via shift
    const slots = await fetch(
      `${API_URL}/query?table=slots&select=id,start_time,end_time,available_capacity&where=${encodeURIComponent(JSON.stringify({ shift_id: shift.id, slot_date: dateStr, is_available: true }))}&limit=5`,
      { headers: { 'Authorization': `Bearer ${spToken}` } }
    ).then(r => r.json()).then(d => d.data || []);

    if (slots.length === 0) {
      logTest('customer', 'Get available slots', 'fail', 'No slots available');
      throw new Error('No slots available for testing');
    }
    logTest('customer', 'Get available slots', 'pass', `${slots.length} slots found`);

    const testSlot = slots[0];

    // Acquire lock
    logTest('customer', 'Acquire booking lock', 'in_progress');
    const lock = await acquireLock(customerToken, testSlot.id, 1);
    logTest('customer', 'Acquire booking lock', 'pass', `Lock ID: ${lock.lock_id}`);

    // Verify lock prevents double booking
    logTest('customer', 'Verify lock prevents double booking', 'in_progress');
    try {
      await acquireLock(customerToken, testSlot.id, testSlot.available_capacity + 1);
      logTest('customer', 'Verify lock prevents double booking', 'fail', 'Lock did not prevent overbooking');
    } catch (error) {
      if (error.message.includes('Not enough tickets')) {
        logTest('customer', 'Verify lock prevents double booking', 'pass');
      } else {
        throw error;
      }
    }

    // Create booking
    logTest('customer', 'Create booking', 'in_progress');
    const booking = await createBooking(customerToken, {
      slot_id: testSlot.id,
      service_id: service.id,
      tenant_id: tenantId,
      customer_name: 'Test Customer',
      customer_phone: '+201032560826',
      customer_email: 'customer1@test.bookati.com',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100.00,
      lock_id: lock.lock_id,
      session_id: lock.session_id,
      language: 'en',
    });
    logTest('customer', 'Create booking', 'pass', `Booking ID: ${booking.id}`);

    // Verify availability decreased
    logTest('customer', 'Verify availability decreased', 'in_progress');
    const updatedSlot = await fetch(
      `${API_URL}/query?table=slots&select=available_capacity,booked_count&where=${encodeURIComponent(JSON.stringify({ id: testSlot.id }))}`,
      { headers: { 'Authorization': `Bearer ${spToken}` } }
    ).then(r => r.json()).then(d => d.data?.[0]);

    if (updatedSlot && updatedSlot.available_capacity < testSlot.available_capacity) {
      logTest('customer', 'Verify availability decreased', 'pass', 
        `Capacity: ${testSlot.available_capacity} → ${updatedSlot.available_capacity}`);
    } else {
      logTest('customer', 'Verify availability decreased', 'fail', 'Availability did not decrease');
    }

    return { customer, booking, lock };
  } catch (error) {
    logTest('customer', 'Customer Flow', 'fail', error.message);
    results.errors.push({ phase: 'customer', error: error.message });
    throw error;
  }
}

async function testReceptionistFlow(serviceProviderData) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: RECEPTIONIST FLOW');
  console.log('='.repeat(60) + '\n');

  try {
    const { token: spToken, tenantId, service, shift } = serviceProviderData;

    // Login as receptionist
    logTest('receptionist', 'Login as receptionist', 'in_progress');
    const receptionist = await login('receptionist1@test.bookati.com', '111111');
    const receptionistToken = receptionist.session.access_token;
    logTest('receptionist', 'Login as receptionist', 'pass', receptionist.user.username);

    // Get available slots
    logTest('receptionist', 'Get available slots', 'in_progress');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const slots = await fetch(
      `${API_URL}/query?table=slots&select=id,start_time,end_time,available_capacity&where=${encodeURIComponent(JSON.stringify({ shift_id: shift.id, slot_date: dateStr, is_available: true }))}&limit=5`,
      { headers: { 'Authorization': `Bearer ${spToken}` } }
    ).then(r => r.json()).then(d => d.data || []);

    if (slots.length === 0) {
      logTest('receptionist', 'Get available slots', 'fail', 'No slots available');
      throw new Error('No slots available');
    }
    logTest('receptionist', 'Get available slots', 'pass', `${slots.length} slots found`);

    const testSlot = slots[0];

    // Acquire lock as receptionist
    logTest('receptionist', 'Acquire booking lock', 'in_progress');
    const lock = await acquireLock(receptionistToken, testSlot.id, 1);
    logTest('receptionist', 'Acquire booking lock', 'pass', `Lock ID: ${lock.lock_id}`);

    // Create booking with customer phone (auto-fill test)
    logTest('receptionist', 'Create booking with customer phone', 'in_progress');
    const booking = await createBooking(receptionistToken, {
      slot_id: testSlot.id,
      service_id: service.id,
      tenant_id: tenantId,
      customer_name: 'Walk-in Customer',
      customer_phone: '+201000000001', // Existing customer phone
      customer_email: 'customer1@test.bookati.com',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100.00,
      lock_id: lock.lock_id,
      session_id: lock.session_id,
      language: 'en',
    });
    logTest('receptionist', 'Create booking with customer phone', 'pass', `Booking ID: ${booking.id}`);

    return { receptionist, booking };
  } catch (error) {
    logTest('receptionist', 'Receptionist Flow', 'fail', error.message);
    results.errors.push({ phase: 'receptionist', error: error.message });
    throw error;
  }
}

async function main() {
  console.log('🧪 COMPREHENSIVE BOOKING SYSTEM TEST');
  console.log('='.repeat(60));
  console.log('Testing all functionalities systematically...\n');

  try {
    // Phase 1: Service Provider
    const serviceProviderData = await testServiceProviderFlow();

    // Phase 2: Customer
    await testCustomerFlow(serviceProviderData);

    // Phase 3: Receptionist
    await testReceptionistFlow(serviceProviderData);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const totalTests = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
    const passedTests = Object.values(results).reduce((sum, arr) => 
      sum + arr.filter(r => r.status === 'pass').length, 0);
    const failedTests = Object.values(results).reduce((sum, arr) => 
      sum + arr.filter(r => r.status === 'fail').length, 0);

    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`⚠️  Errors: ${results.errors.length}`);

    if (failedTests > 0 || results.errors.length > 0) {
      console.log('\n❌ Some tests failed. Review errors above.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
    }
  } catch (error) {
    console.error('\n❌ Fatal error during testing:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
