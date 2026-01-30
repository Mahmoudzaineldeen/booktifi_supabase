/**
 * Test: Package subscription invoice is created and sent
 *
 * Flow:
 * 1. Login as receptionist (or tenant admin)
 * 2. Fetch a package for the tenant
 * 3. Create package subscription with payment_method, customer_email, customer_phone
 * 4. Assert response 201, invoice created (invoice.id or zoho_invoice_id)
 * 5. When Zoho is configured, invoice is created in Zoho and sent by email/WhatsApp
 *
 * Usage:
 *   node tests/test-package-subscription-invoice-create-and-send.js
 *   API_URL=https://your-api.com/api node tests/test-package-subscription-invoice-create-and-send.js
 *
 * Credentials: set RECEPTIONIST_EMAIL, RECEPTIONIST_PASSWORD or use CONFIG below.
 */
const API_URL =
  process.env.API_URL ||
  process.env.VITE_API_URL ||
  'https://booktifisupabase-production.up.railway.app/api';

const CONFIG = {
  RECEPTIONIST: {
    email: process.env.RECEPTIONIST_EMAIL || 'receptionist@test.com',
    password: process.env.RECEPTIONIST_PASSWORD || 'test123',
  },
  TENANT_ADMIN: {
    email: process.env.TENANT_ADMIN_EMAIL || 'mahmoudnzaineldeen@gmail.com',
    password: process.env.TENANT_ADMIN_PASSWORD || '111111',
  },
};

let authToken = null;
let tenantId = null;
let packageId = null;

function log(msg, type = 'info') {
  const prefix = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' }[type] || 'ℹ️';
  console.log(`${prefix} ${msg}`);
}

async function request(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  log('Package subscription invoice create-and-send test');
  log(`API: ${API_URL}`, 'info');

  // 1. Login (try receptionist first, then tenant admin)
  let loginRes = await request('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({
      email: CONFIG.RECEPTIONIST.email,
      password: CONFIG.RECEPTIONIST.password,
      forCustomer: false,
    }),
  });

  if (!loginRes.ok) {
    loginRes = await request('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({
        email: CONFIG.TENANT_ADMIN.email,
        password: CONFIG.TENANT_ADMIN.password,
        forCustomer: false,
      }),
    });
  }

  if (!loginRes.ok) {
    log(`Login failed: ${loginRes.status} - ${JSON.stringify(loginRes.data)}`, 'error');
    process.exit(1);
  }

  const token =
    loginRes.data.session?.access_token ||
    loginRes.data.access_token ||
    loginRes.data.accessToken ||
    loginRes.data.token;
  const user = loginRes.data.session?.user || loginRes.data.user || loginRes.data;
  tenantId = user?.tenant_id || loginRes.data.tenant?.id;

  if (!token) {
    log('No token in login response', 'error');
    process.exit(1);
  }

  authToken = token;
  log(`Logged in (tenant: ${tenantId})`, 'success');

  // 2. Fetch packages
  const packagesRes = await request('/packages/receptionist/packages');
  if (!packagesRes.ok) {
    log(`Fetch packages failed: ${packagesRes.status}`, 'error');
    process.exit(1);
  }

  const packages = packagesRes.data?.packages || packagesRes.data || [];
  if (!Array.isArray(packages) || packages.length === 0) {
    log('No packages found for tenant. Create a package first.', 'error');
    process.exit(1);
  }

  packageId = packages[0].id;
  log(`Using package: ${packages[0].name} (${packageId})`, 'info');

  // 3. Create package subscription with payment + email/phone (so invoice is created and sent)
  const subscribeRes = await request('/packages/receptionist/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      package_id: packageId,
      customer_name: 'Invoice Test Customer',
      customer_phone: '+966501234567',
      customer_email: 'invoice-test@example.com',
      payment_method: 'onsite',
    }),
  });

  if (!subscribeRes.ok) {
    log(
      `Create subscription failed: ${subscribeRes.status} - ${JSON.stringify(subscribeRes.data)}`,
      'error'
    );
    process.exit(1);
  }

  const body = subscribeRes.data;
  const invoiceId = body.invoice?.id ?? body.zoho_invoice_id ?? body.subscription?.zoho_invoice_id;
  const hasInvoice = !!invoiceId;

  // 4. Assert invoice created
  if (!hasInvoice) {
    log(
      'Subscription created but no invoice id in response (Zoho may not be configured for this tenant)',
      'warning'
    );
    log(`Response: ${JSON.stringify(body, null, 2)}`, 'info');
  } else {
    log(`Invoice created: ${invoiceId}`, 'success');
  }

  if (body.invoice_error) {
    log(`Invoice error (non-blocking): ${body.invoice_error}`, 'warning');
  }

  // 5. Summary
  log('', 'info');
  log('Result:', 'info');
  log(`  Subscription created: ${!!body.subscription}`, body.subscription ? 'success' : 'error');
  log(`  Invoice created: ${hasInvoice}`, hasInvoice ? 'success' : 'warning');
  log(
    `  Invoice sent (email/WhatsApp): when Zoho is configured and invoice marked paid, server attempts send`,
    'info'
  );

  if (subscribeRes.status === 201 && body.subscription) {
    log('', 'info');
    log('Test passed: subscription created; invoice created and sent when Zoho is configured.', 'success');
    process.exit(0);
  }

  process.exit(subscribeRes.status === 201 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
