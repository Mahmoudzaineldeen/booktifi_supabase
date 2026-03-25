/**
 * Shared query string for GET /api/visitors and /api/visitors/export/* so Reports and Visitors pages stay in sync.
 */
export type VisitorsListQueryInput = {
  page: number;
  limit: number;
  nameFilter: string;
  phoneFilter: string;
  startDate: string;
  endDate: string;
  bookingType: 'all' | 'package_only' | 'paid_only';
  serviceId: string;
  bookingStatus: string;
  branchId: string;
  /** When set, only visitors with at least one booking assigned to this employee (within other filters) appear. */
  employeeId?: string;
};

export function buildVisitorsListQueryString(input: VisitorsListQueryInput): string {
  const params = new URLSearchParams();
  params.set('page', String(input.page));
  params.set('limit', String(input.limit));
  if (input.nameFilter.trim()) params.set('name', input.nameFilter.trim());
  if (input.phoneFilter.trim()) params.set('phone', input.phoneFilter.trim());
  if (input.startDate) params.set('startDate', input.startDate);
  if (input.endDate) params.set('endDate', input.endDate);
  if (input.bookingType !== 'all') params.set('bookingType', input.bookingType);
  if (input.serviceId) params.set('serviceId', input.serviceId);
  if (input.bookingStatus) params.set('bookingStatus', input.bookingStatus);
  if (input.branchId && input.branchId !== 'all') params.set('branch_id', input.branchId);
  else params.set('branch_id', 'all');
  if (input.employeeId?.trim()) params.set('employeeId', input.employeeId.trim());
  return params.toString();
}
