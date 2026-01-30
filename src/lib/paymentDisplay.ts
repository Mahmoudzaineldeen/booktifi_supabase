/**
 * Payment display helpers: normalize to three display values only.
 * Allowed: Unpaid | Paid On Site | Bank Transfer.
 * Stored in DB: payment_status (unpaid | paid | paid_manual) + payment_method (onsite | transfer).
 */

export type PaymentDisplayValue = 'unpaid' | 'paid_onsite' | 'bank_transfer';

export interface BookingPaymentLike {
  payment_status?: string | null;
  payment_method?: string | null;
}

/**
 * Returns the display value for styling and dropdown option value.
 * unpaid/awaiting_payment/refunded → unpaid
 * paid/paid_manual + transfer → bank_transfer
 * paid/paid_manual + onsite or missing → paid_onsite
 */
export function getPaymentDisplayValue(booking: BookingPaymentLike | null | undefined): PaymentDisplayValue {
  if (!booking?.payment_status) return 'unpaid';
  const status = String(booking.payment_status).toLowerCase();
  const method = booking.payment_method ? String(booking.payment_method).toLowerCase() : '';
  if (status === 'unpaid' || status === 'awaiting_payment' || status === 'refunded') return 'unpaid';
  if (status === 'paid' || status === 'paid_manual') {
    return method === 'transfer' ? 'bank_transfer' : 'paid_onsite';
  }
  return 'unpaid';
}

/** Translation keys for the three payment labels (use with t()). */
export const PAYMENT_DISPLAY_KEYS: Record<PaymentDisplayValue, string> = {
  unpaid: 'payment.displayUnpaid',
  paid_onsite: 'payment.displayPaidOnSite',
  bank_transfer: 'payment.displayBankTransfer',
};

/**
 * Returns the translation key for the payment display label.
 * Use with t(): t(getPaymentDisplayLabelKey(booking))
 */
export function getPaymentDisplayLabelKey(booking: BookingPaymentLike | null | undefined): string {
  return PAYMENT_DISPLAY_KEYS[getPaymentDisplayValue(booking)];
}

/**
 * Returns the translated payment display label (Unpaid | Paid On Site | Bank Transfer).
 * Pass the i18n t function: getPaymentDisplayLabel(booking, t)
 */
export function getPaymentDisplayLabel(
  booking: BookingPaymentLike | null | undefined,
  t: (key: string) => string
): string {
  const key = getPaymentDisplayLabelKey(booking);
  const fallbacks: Record<PaymentDisplayValue, string> = {
    unpaid: 'Unpaid',
    paid_onsite: 'Paid On Site',
    bank_transfer: 'Bank Transfer',
  };
  const value = getPaymentDisplayValue(booking);
  const translated = t(key);
  return translated && translated !== key ? translated : fallbacks[value];
}

/**
 * Map display value back to API payload: payment_status and optional payment_method.
 */
export function displayValueToApiPayload(
  displayValue: PaymentDisplayValue
): { payment_status: 'unpaid' | 'paid' | 'paid_manual'; payment_method?: 'onsite' | 'transfer' } {
  if (displayValue === 'unpaid') {
    return { payment_status: 'unpaid' };
  }
  if (displayValue === 'bank_transfer') {
    return { payment_status: 'paid_manual', payment_method: 'transfer' };
  }
  return { payment_status: 'paid_manual', payment_method: 'onsite' };
}
