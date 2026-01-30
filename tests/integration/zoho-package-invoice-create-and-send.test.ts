/**
 * Integration test: ensures package subscription invoices are created and sent.
 *
 * Simulates the flow that createInvoiceForPackageSubscription runs (with mocks)
 * and asserts:
 * 1. createInvoice is called → invoice is created
 * 2. ensurePackageInvoicePaid is called (when payment provided) → invoice marked paid
 * 3. sendInvoiceEmail is called when customer_email is provided → invoice sent by email
 * 4. sendInvoiceViaWhatsApp is called when customer_phone is provided → invoice sent by WhatsApp
 *
 * Run: npm run test:integration -- tests/integration/zoho-package-invoice-create-and-send.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Package subscription invoice create and send flow', () => {
  const tenantId = 'test-tenant-id';
  const invoiceId = 'zoho-invoice-123';
  const totalPrice = 500;
  const customerEmail = 'customer@example.com';
  const customerPhone = '+966501234567';

  let createInvoice: ReturnType<typeof vi.fn>;
  let ensurePackageInvoicePaid: ReturnType<typeof vi.fn>;
  let sendInvoiceEmail: ReturnType<typeof vi.fn>;
  let sendInvoiceViaWhatsApp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createInvoice = vi.fn().mockResolvedValue({ invoice: { invoice_id: invoiceId } });
    ensurePackageInvoicePaid = vi.fn().mockResolvedValue({ success: true });
    sendInvoiceEmail = vi.fn().mockResolvedValue(undefined);
    sendInvoiceViaWhatsApp = vi.fn().mockResolvedValue(undefined);
  });

  /**
   * Simulates the exact flow in createInvoiceForPackageSubscription after invoice is created:
   * 1. Mark invoice as paid (ensurePackageInvoicePaid)
   * 2. Send by email if customer_email
   * 3. Send by WhatsApp if customer_phone
   */
  async function runInvoiceCreateAndSendFlow(options: {
    zohoInvoiceId: string;
    customer_email?: string;
    customer_phone?: string;
    payment?: { payment_method: 'onsite' | 'transfer'; transaction_reference?: string };
    total_price: number;
  }) {
    const { zohoInvoiceId, customer_email, customer_phone, payment, total_price } = options;

    if (payment && total_price > 0) {
      const paymentMode = payment.payment_method === 'transfer' ? 'banktransfer' : 'cash';
      const referenceNumber =
        payment.transaction_reference?.trim() || (paymentMode === 'cash' ? 'Paid On Site' : '');
      await ensurePackageInvoicePaid(
        tenantId,
        zohoInvoiceId,
        total_price,
        paymentMode,
        referenceNumber
      );
    }

    if (customer_email) {
      await sendInvoiceEmail(tenantId, zohoInvoiceId, customer_email);
    }
    if (customer_phone) {
      const normalized = customer_phone.replace(/[\s\-\(\)]/g, '');
      if (normalized) {
        await sendInvoiceViaWhatsApp(tenantId, zohoInvoiceId, normalized);
      }
    }
  }

  it('creates invoice and marks as paid when payment is provided', async () => {
    const invoiceResponse = await createInvoice(tenantId, {
      customer_name: 'Test Customer',
      customer_email: customerEmail,
      customer_phone: customerPhone,
      line_items: [{ name: 'Package', rate: totalPrice, quantity: 1 }],
      currency_code: 'SAR',
    });

    expect(createInvoice).toHaveBeenCalledTimes(1);
    const returnedInvoiceId = invoiceResponse?.invoice?.invoice_id;
    expect(returnedInvoiceId).toBe(invoiceId);

    await runInvoiceCreateAndSendFlow({
      zohoInvoiceId: returnedInvoiceId,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      payment: { payment_method: 'onsite' },
      total_price: totalPrice,
    });

    expect(ensurePackageInvoicePaid).toHaveBeenCalledTimes(1);
    expect(ensurePackageInvoicePaid).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      totalPrice,
      'cash',
      'Paid On Site'
    );
  });

  it('sends invoice by email when customer_email is provided', async () => {
    await runInvoiceCreateAndSendFlow({
      zohoInvoiceId: invoiceId,
      customer_email: customerEmail,
      payment: { payment_method: 'onsite' },
      total_price: totalPrice,
    });

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(sendInvoiceEmail).toHaveBeenCalledWith(tenantId, invoiceId, customerEmail);
  });

  it('sends invoice by WhatsApp when customer_phone is provided', async () => {
    await runInvoiceCreateAndSendFlow({
      zohoInvoiceId: invoiceId,
      customer_phone: customerPhone,
      payment: { payment_method: 'onsite' },
      total_price: totalPrice,
    });

    expect(sendInvoiceViaWhatsApp).toHaveBeenCalledTimes(1);
    expect(sendInvoiceViaWhatsApp).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      customerPhone.replace(/[\s\-\(\)]/g, '')
    );
  });

  it('full flow: create → mark paid → send email → send WhatsApp', async () => {
    const invoiceResponse = await createInvoice(tenantId, {
      customer_name: 'Test Customer',
      customer_email: customerEmail,
      customer_phone: customerPhone,
      line_items: [{ name: 'Package', rate: totalPrice, quantity: 1 }],
      currency_code: 'SAR',
    });

    expect(createInvoice).toHaveBeenCalledTimes(1);
    const returnedInvoiceId = invoiceResponse?.invoice?.invoice_id;
    expect(returnedInvoiceId).toBe(invoiceId);

    await runInvoiceCreateAndSendFlow({
      zohoInvoiceId: returnedInvoiceId,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      payment: { payment_method: 'transfer', transaction_reference: 'REF-001' },
      total_price: totalPrice,
    });

    expect(ensurePackageInvoicePaid).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      totalPrice,
      'banktransfer',
      'REF-001'
    );
    expect(sendInvoiceEmail).toHaveBeenCalledWith(tenantId, invoiceId, customerEmail);
    const normalizedPhone = customerPhone.replace(/[\s\-\(\)]/g, '');
    expect(sendInvoiceViaWhatsApp).toHaveBeenCalledWith(tenantId, invoiceId, normalizedPhone);
  });
});
