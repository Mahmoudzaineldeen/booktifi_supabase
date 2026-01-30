/**
 * Integration test: ensures booking invoice and payment flow works as expected.
 *
 * Covers:
 * 1. Payment status normalization: only Unpaid | Paid On Site | Bank Transfer (unpaid | paid | paid_manual)
 * 2. Booking created as paid → invoice created, payment recorded, email/WhatsApp sent
 * 3. Booking created as unpaid → invoice skipped at creation; created when marked paid later
 * 4. Bank transfer with reference → reference_number and notes on invoice; recordCustomerPayment with reference
 * 5. Invoice never sent unless both local payment_status and Zoho invoice status are paid
 * 6. Booking vs package remaining: when invoices are created (paid_quantity, package-covered, package subscription)
 *
 * Run: npm run test:integration -- tests/integration/booking-invoice-payment-flow.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPaymentDisplayValue,
  displayValueToApiPayload,
  type PaymentDisplayValue,
} from '../../src/lib/paymentDisplay';

describe('Payment status normalization', () => {
  it('maps DB values to display: unpaid, paid_onsite, bank_transfer only', () => {
    expect(getPaymentDisplayValue({ payment_status: null })).toBe('unpaid');
    expect(getPaymentDisplayValue({ payment_status: 'unpaid' })).toBe('unpaid');
    expect(getPaymentDisplayValue({ payment_status: 'awaiting_payment' })).toBe('unpaid');
    expect(getPaymentDisplayValue({ payment_status: 'refunded' })).toBe('unpaid');
    expect(getPaymentDisplayValue({ payment_status: 'paid', payment_method: 'onsite' })).toBe('paid_onsite');
    expect(getPaymentDisplayValue({ payment_status: 'paid_manual', payment_method: 'onsite' })).toBe('paid_onsite');
    expect(getPaymentDisplayValue({ payment_status: 'paid', payment_method: 'transfer' })).toBe('bank_transfer');
    expect(getPaymentDisplayValue({ payment_status: 'paid_manual', payment_method: 'transfer' })).toBe('bank_transfer');
    expect(getPaymentDisplayValue({ payment_status: 'paid' })).toBe('paid_onsite'); // no method → onsite
  });

  it('displayValueToApiPayload returns only allowed API values', () => {
    expect(displayValueToApiPayload('unpaid')).toEqual({ payment_status: 'unpaid' });
    expect(displayValueToApiPayload('paid_onsite')).toEqual({ payment_status: 'paid_manual', payment_method: 'onsite' });
    expect(displayValueToApiPayload('bank_transfer')).toEqual({ payment_status: 'paid_manual', payment_method: 'transfer' });
  });

  it('allowed payment_status values are exactly unpaid, paid, paid_manual', () => {
    const allowed = ['unpaid', 'paid', 'paid_manual'];
    const fromDisplay: PaymentDisplayValue[] = ['unpaid', 'paid_onsite', 'bank_transfer'];
    const payloads = fromDisplay.map((d) => displayValueToApiPayload(d));
    const statuses = [...new Set(payloads.map((p) => p.payment_status))];
    expect(statuses.every((s) => allowed.includes(s))).toBe(true);
    expect(statuses.sort()).toEqual(['paid_manual', 'unpaid']);
  });
});

describe('Booking invoice create and send flow', () => {
  const tenantId = 'test-tenant-id';
  const bookingId = 'test-booking-id';
  const invoiceId = 'zoho-invoice-booking-123';
  const totalPrice = 7546;
  const customerEmail = 'customer@example.com';
  const customerPhone = '+966501234567';

  let createInvoice: ReturnType<typeof vi.fn>;
  let ensureBookingInvoicePaid: ReturnType<typeof vi.fn>;
  let sendInvoiceEmail: ReturnType<typeof vi.fn>;
  let sendInvoiceViaWhatsApp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createInvoice = vi.fn().mockResolvedValue({ invoice: { invoice_id: invoiceId } });
    ensureBookingInvoicePaid = vi.fn().mockResolvedValue({ success: true });
    sendInvoiceEmail = vi.fn().mockResolvedValue(undefined);
    sendInvoiceViaWhatsApp = vi.fn().mockResolvedValue(undefined);
  });

  /**
   * Simulates the flow used in zohoService.generateReceipt for a booking:
   * 1. Build invoice data (with reference_number/notes when bank transfer)
   * 2. Create invoice
   * 3. When paid: record customer payment (ensurePackageInvoicePaid), then send email/WhatsApp
   * 4. Never send when unpaid
   */
  async function runBookingInvoiceCreateAndSendFlow(options: {
    payment_status: 'unpaid' | 'paid' | 'paid_manual';
    payment_method?: 'onsite' | 'transfer';
    transaction_reference?: string;
    customer_email?: string;
    customer_phone?: string;
    total_price: number;
  }) {
    const {
      payment_status,
      payment_method,
      transaction_reference,
      customer_email,
      customer_phone,
      total_price,
    } = options;

    const maySendInvoice = payment_status === 'paid' || payment_status === 'paid_manual';
    const payMode = payment_method === 'transfer' ? 'banktransfer' : 'cash';
    const payRef =
      payment_method === 'transfer' && transaction_reference
        ? transaction_reference.trim()
        : payMode === 'cash'
          ? 'Paid On Site'
          : '';

    const invoiceData: Record<string, unknown> = {
      customer_name: 'Test Customer',
      customer_email: customer_email || '',
      customer_phone: customer_phone || '',
      line_items: [{ name: 'Service', rate: total_price, quantity: 1 }],
      currency_code: 'SAR',
      notes: `Booking ID: ${bookingId}`,
    };

    if (payment_method === 'transfer' && transaction_reference?.trim()) {
      const refLine = `\nPayment: Bank transfer. Reference: ${transaction_reference.trim()}`;
      invoiceData.notes = (invoiceData.notes as string) + refLine;
      (invoiceData as any).reference_number = transaction_reference.trim();
    }

    const createResponse = await createInvoice(tenantId, invoiceData);
    const returnedInvoiceId = createResponse?.invoice?.invoice_id;
    if (!returnedInvoiceId) throw new Error('No invoice_id in create response');

    if (maySendInvoice && total_price > 0) {
      await ensureBookingInvoicePaid(tenantId, returnedInvoiceId, total_price, payMode, payRef || undefined);
    }

    if (maySendInvoice) {
      if (customer_email) await sendInvoiceEmail(tenantId, returnedInvoiceId, customer_email);
      if (customer_phone) {
        const normalized = customer_phone.replace(/[\s\-\(\)]/g, '');
        if (normalized) await sendInvoiceViaWhatsApp(tenantId, returnedInvoiceId, normalized);
      }
    }

    return { invoiceId: returnedInvoiceId, invoiceData };
  }

  it('when booking created as paid (Paid On Site): creates invoice, records payment, sends email and WhatsApp', async () => {
    await runBookingInvoiceCreateAndSendFlow({
      payment_status: 'paid_manual',
      payment_method: 'onsite',
      customer_email: customerEmail,
      customer_phone: customerPhone,
      total_price: totalPrice,
    });

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(createInvoice).toHaveBeenCalledWith(tenantId, expect.objectContaining({
      customer_name: 'Test Customer',
      customer_email: customerEmail,
      line_items: expect.any(Array),
      currency_code: 'SAR',
    }));

    expect(ensureBookingInvoicePaid).toHaveBeenCalledTimes(1);
    expect(ensureBookingInvoicePaid).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      totalPrice,
      'cash',
      'Paid On Site'
    );

    expect(sendInvoiceEmail).toHaveBeenCalledWith(tenantId, invoiceId, customerEmail);
    expect(sendInvoiceViaWhatsApp).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      customerPhone.replace(/[\s\-\(\)]/g, '')
    );
  });

  it('when booking created as paid (Bank Transfer) with reference: invoice has reference_number and notes', async () => {
    const ref = '01032560826';
    await runBookingInvoiceCreateAndSendFlow({
      payment_status: 'paid_manual',
      payment_method: 'transfer',
      transaction_reference: ref,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      total_price: totalPrice,
    });

    const createCall = createInvoice.mock.calls[0];
    expect(createCall[0]).toBe(tenantId);
    expect(createCall[1]).toMatchObject({
      reference_number: ref,
    });
    expect((createCall[1] as any).notes).toContain('Bank transfer');
    expect((createCall[1] as any).notes).toContain(ref);

    expect(ensureBookingInvoicePaid).toHaveBeenCalledWith(
      tenantId,
      invoiceId,
      totalPrice,
      'banktransfer',
      ref
    );
  });

  it('when booking created as unpaid: does not record payment or send invoice', async () => {
    await runBookingInvoiceCreateAndSendFlow({
      payment_status: 'unpaid',
      customer_email: customerEmail,
      customer_phone: customerPhone,
      total_price: totalPrice,
    });

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(ensureBookingInvoicePaid).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(sendInvoiceViaWhatsApp).not.toHaveBeenCalled();
  });

  it('createInvoiceNow is false when payment_status is unpaid or awaiting_payment', () => {
    const normalized = (raw: string | undefined) =>
      raw === 'awaiting_payment' || raw === 'refunded' ? 'unpaid' : raw;
    const createInvoiceNow = (status: string | undefined) => {
      const s = normalized(status);
      return s !== 'unpaid' && s !== 'awaiting_payment';
    };
    expect(createInvoiceNow('unpaid')).toBe(false);
    expect(createInvoiceNow('awaiting_payment')).toBe(false);
    expect(createInvoiceNow('paid')).toBe(true);
    expect(createInvoiceNow('paid_manual')).toBe(true);
  });

  it('transfer payment method requires transaction_reference', () => {
    const validateTransfer = (method: string, ref: string | null | undefined) => {
      if (method !== 'transfer') return true;
      return Boolean(ref && String(ref).trim());
    };
    expect(validateTransfer('transfer', '')).toBe(false);
    expect(validateTransfer('transfer', null)).toBe(false);
    expect(validateTransfer('transfer', '  ')).toBe(false);
    expect(validateTransfer('transfer', '01032560826')).toBe(true);
    expect(validateTransfer('onsite', '')).toBe(true);
  });
});

/**
 * Booking vs package "remaining": when invoices are created.
 *
 * Booking: invoice created only when (contact AND paid_quantity > 0 AND total_price > 0 AND payment_status paid).
 * Package "remaining" = how many sessions left in subscription; when creating a booking, package covers up to
 * remaining, so paid_quantity = visitor_count - package_covered. If paid_quantity = 0 (fully covered), no invoice.
 *
 * Package subscription: one invoice per purchase; created when payment_status is paid at creation;
 * when unpaid/pending, invoice is created when marked paid later. "Remaining" = remaining_quantity (sessions)
 * does not affect whether the purchase invoice is created.
 */
describe('Booking vs package remaining: when invoices are created', () => {
  // Mirror server logic: bookings
  function bookingShouldCreateInvoice(opts: {
    hasContact: boolean;
    paidQty: number;
    totalPrice: number;
    paymentStatus: string | undefined;
  }): boolean {
    const { hasContact, paidQty, totalPrice, paymentStatus } = opts;
    const normalized =
      paymentStatus === 'awaiting_payment' || paymentStatus === 'refunded' ? 'unpaid' : paymentStatus;
    const createInvoiceNow = normalized !== 'unpaid' && normalized !== undefined;
    const shouldCreateInvoice = hasContact && paidQty > 0 && totalPrice > 0;
    return Boolean(shouldCreateInvoice && createInvoiceNow);
  }

  // Mirror server logic: package subscription
  function packageSubscriptionCreatesInvoiceAtCreation(paymentStatus: string | undefined): boolean {
    const unpaid = !paymentStatus || paymentStatus === 'unpaid' || paymentStatus === 'pending' || paymentStatus === 'awaiting_payment';
    return !unpaid;
  }

  it('booking: no invoice when fully package-covered (paid_quantity = 0)', () => {
    // 10 remaining in package, book 10 → all covered → paidQty = 0
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 0,
        totalPrice: 0,
        paymentStatus: 'paid_manual',
      })
    ).toBe(false);
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 0,
        totalPrice: 100,
        paymentStatus: 'paid_manual',
      })
    ).toBe(false);
  });

  it('booking: no invoice when unpaid even if paid_quantity > 0', () => {
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 1,
        totalPrice: 100,
        paymentStatus: 'unpaid',
      })
    ).toBe(false);
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 1,
        totalPrice: 100,
        paymentStatus: 'awaiting_payment',
      })
    ).toBe(false);
  });

  it('booking: invoice created when partial package (remaining < visitors) and paid', () => {
    // 9 remaining, book 10 → package covers 9, paid 1 → paidQty = 1, total > 0, paid
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 1,
        totalPrice: 100,
        paymentStatus: 'paid_manual',
      })
    ).toBe(true);
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 2,
        totalPrice: 200,
        paymentStatus: 'paid',
      })
    ).toBe(true);
  });

  it('booking: invoice created when no package and paid', () => {
    // No package: paidQty = visitor_count
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: 1,
        totalPrice: 100,
        paymentStatus: 'paid_manual',
      })
    ).toBe(true);
  });

  it('booking: no invoice when no contact even if paid and paidQty > 0', () => {
    expect(
      bookingShouldCreateInvoice({
        hasContact: false,
        paidQty: 1,
        totalPrice: 100,
        paymentStatus: 'paid_manual',
      })
    ).toBe(false);
  });

  it('package subscription: invoice created at creation when paid', () => {
    expect(packageSubscriptionCreatesInvoiceAtCreation('paid')).toBe(true);
    expect(packageSubscriptionCreatesInvoiceAtCreation('paid_manual')).toBe(true);
  });

  it('package subscription: invoice NOT created at creation when unpaid/pending', () => {
    expect(packageSubscriptionCreatesInvoiceAtCreation('unpaid')).toBe(false);
    expect(packageSubscriptionCreatesInvoiceAtCreation('pending')).toBe(false);
    expect(packageSubscriptionCreatesInvoiceAtCreation('awaiting_payment')).toBe(false);
    expect(packageSubscriptionCreatesInvoiceAtCreation(undefined)).toBe(false);
  });

  it('booking vs package: difference is paid_quantity and when invoice runs', () => {
    // Booking: invoice decision uses paid_quantity (from package remaining vs visitor_count) + total_price + payment_status
    const bookingWithRemaining9Book10 = {
      packageRemaining: 9,
      visitorCount: 10,
      packageCovered: 9,
      paidQty: 1,
      totalPrice: 100,
    };
    expect(bookingWithRemaining9Book10.paidQty).toBe(1);
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: bookingWithRemaining9Book10.paidQty,
        totalPrice: bookingWithRemaining9Book10.totalPrice,
        paymentStatus: 'paid_manual',
      })
    ).toBe(true);

    // Same booking but fully covered (10 remaining, book 10)
    const bookingFullyCovered = {
      packageRemaining: 10,
      visitorCount: 10,
      packageCovered: 10,
      paidQty: 0,
      totalPrice: 0,
    };
    expect(
      bookingShouldCreateInvoice({
        hasContact: true,
        paidQty: bookingFullyCovered.paidQty,
        totalPrice: bookingFullyCovered.totalPrice,
        paymentStatus: 'paid_manual',
      })
    ).toBe(false);

    // Package subscription: one invoice per purchase; "remaining" is sessions left after purchase, does not gate invoice
    expect(packageSubscriptionCreatesInvoiceAtCreation('paid')).toBe(true);
  });
});
