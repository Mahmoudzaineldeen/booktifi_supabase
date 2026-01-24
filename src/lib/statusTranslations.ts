/**
 * Helper functions for translating status values
 */

export function translateBookingStatus(status: string, t: (key: string) => string): string {
  const statusMap: Record<string, string> = {
    'pending': t('status.pending'),
    'confirmed': t('status.confirmed'),
    'checked_in': t('status.checked_in'),
    'completed': t('status.completed'),
    'cancelled': t('status.cancelled'),
  };
  
  return statusMap[status] || status;
}

export function translatePaymentStatus(status: string, t: (key: string) => string): string {
  const statusMap: Record<string, string> = {
    'unpaid': t('status.unpaid'),
    'paid': t('status.paid'),
    'paid_manual': t('status.paid_manual'),
    'awaiting_payment': t('status.awaiting_payment'),
    'refunded': t('status.refunded'),
  };
  
  return statusMap[status] || status;
}
