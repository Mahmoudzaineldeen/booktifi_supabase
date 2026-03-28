/**
 * How many seats/visitors should be treated as "paid / billable" for invoice creation.
 *
 * Bookings often have `paid_quantity` left at 0 while `visitor_count` and `total_price` are set
 * (especially after manual mark-paid or gateway callbacks). Using only `paid_quantity ?? visitor_count`
 * treats explicit 0 as final and skips invoices incorrectly.
 */
export type PaidQuantityInput = {
  paid_quantity?: number | null;
  visitor_count?: number | null;
  package_covered_quantity?: number | null;
};

export function effectivePaidQuantityForInvoice(b: PaidQuantityInput): number {
  const visitors = b.visitor_count ?? 0;
  const pkg = b.package_covered_quantity ?? 0;
  const pq = b.paid_quantity;

  if (visitors <= 0) {
    return pq != null && pq > 0 ? pq : 0;
  }

  if (pkg >= visitors) {
    return 0;
  }

  if (pq != null && pq > 0) {
    return pq;
  }

  return Math.max(0, visitors - pkg);
}
