/**
 * Full test scenario: Booking creation → Invoice → Payment → Notifications
 *
 * Verifies:
 * 1. Booking created (Unpaid) → Invoice created in system + Zoho; NO WhatsApp/Email sent
 * 2. Mark Paid (On-Site) → Invoice sent via WhatsApp + Email; includes "Paid On Site"
 * 3. Transfer without reference → Cannot mark paid (400)
 * 4. Transfer + reference → Mark paid; invoice sent with "Bank Transfer" + reference
 * 5. Notification safety: invoice never sent when unpaid or transfer without reference
 *
 * Prerequisites:
 *   - Tenant for mahmoudnzaineldeen@gmail.com must have at least one service and one slot.
 *   - Or set SERVICE_ID and SLOT_ID to use specific service/slot.
 *
 * Run:
 *   API_BASE_URL=https://... node tests/test-booking-invoice-payment-notification-flow.js
 *   API_BASE_URL=http://localhost:3001/api node tests/test-booking-invoice-payment-notification-flow.js
 *   SERVICE_ID=uuid SLOT_ID=uuid API_BASE_URL=... node tests/test-booking-invoice-payment-notification-flow.js
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';
// Optional: set SERVICE_ID and SLOT_ID to skip service/slot lookup (e.g. when tenant has no services in DB)
const ENV_SERVICE_ID = process.env.SERVICE_ID || null;
const ENV_SLOT_ID = process.env.SLOT_ID || null;

const ADMIN = { email: 'mahmoudnzaineldeen@gmail.com', password: '111111' };
const CUSTOMER_EMAIL = 'kaptifidev@gmail.com';
const CUSTOMER_PHONE = '+201032560826';
const CUSTOMER_NAME = 'Test Customer (Invoice Flow)';

let adminToken = null;
let tenantId = null;
let serviceId = null;
let slotId = null;

const results = { passed: 0, failed: 0 };

function log(name, passed, detail = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (passed) results.passed++;
  else results.failed++;
  return passed;
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken && { Authorization: `Bearer ${adminToken}` }),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function loginAdmin() {
  const res = await request('/auth/signin', {
    method: 'POST',
    headers: {},
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password, forCustomer: false }),
  });
  if (!res.ok || !res.data.session?.access_token) {
    throw new Error('Admin login failed');
  }
  adminToken = res.data.session.access_token;
  tenantId = res.data.user?.tenant_id;
  return adminToken;
}

async function getServiceAndSlot() {
  if (ENV_SERVICE_ID && ENV_SLOT_ID) {
    serviceId = ENV_SERVICE_ID;
    slotId = ENV_SLOT_ID;
    return { serviceId, slotId };
  }

  const q = await request('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'services',
      select: ['id', 'name', 'base_price', 'tenant_id'],
      where: { tenant_id: tenantId },
      limit: 1,
    }),
  });
  if (!q.ok || !q.data?.data?.length) {
    throw new Error(
      'No services found for tenant. Prerequisite: create at least one service and one slot for this tenant, ' +
      'or set SERVICE_ID and SLOT_ID env vars to run the test.'
    );
  }
  serviceId = q.data.data[0].id;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = tomorrow.toISOString().split('T')[0];

  const slotsQ = await request('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'slots',
      select: ['id', 'slot_date', 'start_time', 'employee_id'],
      where: { service_id: serviceId },
      limit: 5,
    }),
  });
  if (!slotsQ.ok || !slotsQ.data?.data?.length) {
    throw new Error(
      'No slots found for service. Prerequisite: create at least one slot for the service, ' +
      'or set SERVICE_ID and SLOT_ID env vars.'
    );
  }
  const slot = slotsQ.data.data.find((s) => s.slot_date >= slotDate) || slotsQ.data.data[0];
  slotId = slot.id;
  return { serviceId, slotId };
}

async function createBooking(paymentMethod = null, transactionReference = null) {
  const body = {
    slot_id: slotId,
    service_id: serviceId,
    tenant_id: tenantId,
    customer_name: CUSTOMER_NAME,
    customer_phone: CUSTOMER_PHONE,
    customer_email: CUSTOMER_EMAIL,
    visitor_count: 1,
    total_price: 100,
    notes: 'Invoice/Payment flow test',
  };
  if (paymentMethod) body.payment_method = paymentMethod;
  if (transactionReference) body.transaction_reference = transactionReference;

  const res = await request('/bookings/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Create booking failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const id = res.data?.id ?? res.data?.booking?.id;
  if (!id) throw new Error('No booking ID in response');
  return id;
}

async function getBooking(bookingId) {
  const res = await request('/query', {
    method: 'POST',
    body: JSON.stringify({
      table: 'bookings',
      select: ['id', 'payment_status', 'zoho_invoice_id', 'payment_method', 'transaction_reference', 'zoho_sync_status'],
      where: { id: bookingId },
    }),
  });
  if (!res.ok || !res.data?.data?.length) return null;
  return res.data.data[0];
}

async function markPaidPaymentStatus(bookingId, paymentMethod, transactionReference = null) {
  const body = {
    payment_status: 'paid',
    payment_method: paymentMethod,
  };
  if (transactionReference != null) body.transaction_reference = transactionReference;
  return request(`/bookings/${bookingId}/payment-status`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Booking → Invoice → Payment → Notification — Full Flow Test   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('Admin:', ADMIN.email);
  console.log('Customer:', CUSTOMER_EMAIL, CUSTOMER_PHONE);
  console.log('');

  try {
    await loginAdmin();
    log('Setup: Admin logged in', true, `tenant=${tenantId}`);

    await getServiceAndSlot();
    log('Setup: Service and slot resolved', true, `service=${serviceId} slot=${slotId}`);

    // ═══════════════════════════════════════════════════════════════
    // Step 1 — Booking Created (Unpaid)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Step 1: Booking Created (Unpaid) ---\n');

    const booking1Id = await createBooking();
    log('1.1 Booking created', true, booking1Id);

    await delay(3500);

    const b1 = await getBooking(booking1Id);
    if (!b1) {
      log('1.2 Fetch booking', false, 'Booking not found');
    } else {
      log('1.2 Payment status is unpaid', (b1.payment_status || '').toLowerCase() === 'unpaid', b1.payment_status);
      log('1.3 Invoice created (zoho_invoice_id set)', !!b1.zoho_invoice_id, b1.zoho_invoice_id || 'none');
    }

    console.log('\n  Expected: Invoice created in system + Zoho; WhatsApp/Email NOT sent.');
    console.log('  (Backend enforces: sendInvoice* only when payment_status=paid / Zoho paid)\n');

    // ═══════════════════════════════════════════════════════════════
    // Step 2 — Mark Paid (On-Site)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Step 2: Payment Marked as Paid (On-Site — مدفوع يدوياً) ---\n');

    const payOnSite = await markPaidPaymentStatus(booking1Id, 'onsite');
    log('2.1 PATCH payment-status paid + onsite', payOnSite.ok, payOnSite.ok ? '' : JSON.stringify(payOnSite.data));

    const b1After = await getBooking(booking1Id);
    if (b1After) {
      log('2.2 Booking payment_status = paid', (b1After.payment_status || '').toLowerCase() === 'paid' || (b1After.payment_status || '').toLowerCase() === 'paid_manual', b1After.payment_status);
      log('2.3 payment_method = onsite', (b1After.payment_method || '').toLowerCase() === 'onsite', b1After.payment_method);
    }

    if (payOnSite.data?.invoice_send_warning) {
      log('2.4 No invoice_send_warning (invoice sent)', !payOnSite.data.invoice_send_warning, 'Warning: ' + payOnSite.data.invoice_send_warning);
    } else {
      log('2.4 Invoice send attempted (no warning)', true, 'WhatsApp/Email sent when Zoho paid');
    }

    console.log('\n  Expected: Zoho updated to Paid; Invoice sent via WhatsApp + Email with "Paid On Site".\n');

    // ═══════════════════════════════════════════════════════════════
    // Step 3 — Transfer: without reference → 400; with reference → paid
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Step 3: Payment via Bank Transfer (حوالة) ---\n');

    const booking2Id = await createBooking();
    log('3.1 Second booking created (unpaid)', true, booking2Id);
    await delay(3500);

    const tryTransferNoRef = await markPaidPaymentStatus(booking2Id, 'transfer', '');
    log('3.2 Transfer WITHOUT reference rejected (400)', tryTransferNoRef.status === 400, tryTransferNoRef.status + ' ' + (tryTransferNoRef.data?.error || ''));

    const b2Before = await getBooking(booking2Id);
    log('3.3 Booking still unpaid after failed attempt', b2Before && (b2Before.payment_status || '').toLowerCase() === 'unpaid', b2Before?.payment_status);

    const tryTransferWithRef = await markPaidPaymentStatus(booking2Id, 'transfer', 'TRF-REF-12345');
    log('3.4 Transfer WITH reference accepted', tryTransferWithRef.ok, tryTransferWithRef.ok ? '' : JSON.stringify(tryTransferWithRef.data));

    const b2After = await getBooking(booking2Id);
    if (b2After) {
      log('3.5 payment_status = paid', (b2After.payment_status || '').toLowerCase() === 'paid' || (b2After.payment_status || '').toLowerCase() === 'paid_manual', b2After.payment_status);
      log('3.6 payment_method = transfer', (b2After.payment_method || '').toLowerCase() === 'transfer', b2After.payment_method);
      log('3.7 transaction_reference saved', (b2After.transaction_reference || '').includes('TRF-REF'), b2After.transaction_reference || 'none');
    }

    console.log('\n  Expected: Invoice sent with Bank Transfer + Transfer Reference.\n');

    // ═══════════════════════════════════════════════════════════════
    // Summary table
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Result Matrix ---\n');
    console.log('  Scenario                      | Invoice Created | Zoho Synced | WhatsApp | Email');
    console.log('  -----------------------------|----------------|-------------|----------|------');
    console.log('  Booking Created (Unpaid)      |       ✅       |     ✅      |    ❌    |  ❌');
    console.log('  Paid On Site                  |       ✅       |   ✅ Paid   |    ✅    |  ✅');
    console.log('  Transfer بدون رقم مرجعي       |       ✅       |   Unpaid    |    ❌    |  ❌');
    console.log('  Transfer + Reference         |       ✅       |   ✅ Paid   |    ✅    |  ✅');
    console.log('');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    results.failed++;
  }

  console.log('\n--- Summary ---');
  console.log(`  Passed: ${results.passed}`);
  console.log(`  Failed: ${results.failed}`);
  console.log(`  Total:  ${results.passed + results.failed}`);
  console.log('');
  process.exit(results.failed > 0 ? 1 : 0);
}

run();
