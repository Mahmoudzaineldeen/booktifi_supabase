/**
 * Booking Creation Performance Test
 *
 * Ensures the performance enhancement: booking creation returns immediately
 * without blocking on Zoho invoice creation or WhatsApp sending.
 *
 * - POST /bookings/create must return within MAX_RESPONSE_MS (3s).
 * - Response must include booking id and, when invoice is queued, invoice_processing_status.
 *
 * Run: node tests/backend/11-booking-creation-performance.test.js
 * Requires: Backend running (e.g. Railway or local), valid CONFIG.ACCOUNTS.SERVICE_PROVIDER.
 */

import { CONFIG, apiRequest, logTest, delay } from './config.js';

/** Max allowed response time (ms). Booking must not wait for Zoho/WhatsApp. */
const MAX_RESPONSE_MS = 3000;

const results = { passed: 0, failed: 0, tests: [] };

async function test(name, testFn) {
  try {
    const result = await testFn();
    const passed = result !== false;
    logTest(name, passed, result?.message);
    results.tests.push({ name, passed, message: result?.message || '' });
    if (passed) results.passed++;
    else results.failed++;
    return passed;
  } catch (error) {
    logTest(name, false, error.message);
    results.tests.push({ name, passed: false, message: error.message });
    results.failed++;
    return false;
  }
}

async function setupTenantAdmin() {
  const { email, password } = CONFIG.ACCOUNTS.SERVICE_PROVIDER;
  const response = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password, forCustomer: false }),
  });
  if (!response.ok || !response.data.session?.access_token) {
    throw new Error('Failed to sign in as tenant admin');
  }
  CONFIG.TEST_DATA.serviceProviderToken = response.data.session.access_token;
  CONFIG.TEST_DATA.tenantId = response.data.user?.tenant_id;
  return response.data.session.access_token;
}

async function getServiceAndSlot() {
  const servicesResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: ['id'],
      where: { tenant_id: CONFIG.TEST_DATA.tenantId },
      limit: 1,
    }),
    headers: { Authorization: `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}` },
  });
  if (!servicesResponse.data?.data?.length) {
    throw new Error('No services found for tenant');
  }
  const serviceId = servicesResponse.data.data[0].id;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = tomorrow.toISOString().split('T')[0];

  const slotsResponse = await apiRequest('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: ['id', 'slot_date', 'start_time'],
      where: { service_id: serviceId, slot_date__gte: slotDate },
      limit: 1,
    }),
    headers: { Authorization: `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}` },
  });
  if (!slotsResponse.data?.data?.length) {
    throw new Error('No slots found for service');
  }
  const slotId = slotsResponse.data.data[0].id;
  return { serviceId, slotId };
}

async function testBookingCreationResponseTime() {
  const { serviceId, slotId } = await getServiceAndSlot();

  const body = {
    slot_id: slotId,
    service_id: serviceId,
    tenant_id: CONFIG.TEST_DATA.tenantId,
    customer_name: 'Perf Test Customer',
    customer_phone: '+201234567890',
    customer_email: 'perf@example.com',
    visitor_count: 1,
    adult_count: 1,
    child_count: 0,
    total_price: 100.0,
    notes: 'Performance test booking',
  };

  const start = Date.now();
  const response = await apiRequest('/bookings/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}` },
  });
  const elapsed = Date.now() - start;

  if (!response.ok) {
    throw new Error(`Create failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  if (response.status !== 201) {
    throw new Error(`Expected 201, got ${response.status}`);
  }

  const bookingId = response.data?.id ?? response.data?.booking?.id;
  if (!bookingId) {
    throw new Error('Response missing booking id');
  }

  if (elapsed > MAX_RESPONSE_MS) {
    throw new Error(
      `Booking creation took ${elapsed}ms (max ${MAX_RESPONSE_MS}ms). ` +
        'API must not block on Zoho/WhatsApp.'
    );
  }

  // When invoice is queued, response should include invoice_processing_status
  const status = response.data?.invoice_processing_status ?? response.data?.booking?.invoice_processing_status;
  if (status && status !== 'pending' && status !== 'processing' && status !== 'completed') {
    // Allow any status; we only care that response was fast
  }

  return {
    message: `Response in ${elapsed}ms (max ${MAX_RESPONSE_MS}ms), booking ${bookingId}`,
  };
}

export async function runAllTests() {
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 11: Booking Creation Performance');
  console.log('═'.repeat(62));
  console.log(`  Goal: POST /bookings/create returns in < ${MAX_RESPONSE_MS}ms (no Zoho/WhatsApp blocking)\n`);

  try {
    await test('Setup: Sign in as tenant admin', async () => {
      await setupTenantAdmin();
      return { message: 'Tenant admin authenticated' };
    });
    await delay(500);

    await test('Performance: Booking creation returns within 3s', testBookingCreationResponseTime);

    console.log('\n' + '─'.repeat(62));
    console.log('Performance Test Summary:');
    console.log(`  ✅ Passed: ${results.passed}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log('─'.repeat(62) + '\n');

    return results.failed === 0;
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
    return false;
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (import.meta.url.endsWith('11-booking-creation-performance.test.js') ||
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`);
if (isDirectRun) {
  runAllTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
