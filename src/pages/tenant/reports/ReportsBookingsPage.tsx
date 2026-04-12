import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../contexts/AuthContext';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { getApiUrl } from '../../../lib/apiUrl';
import { apiFetch, getAuthHeaders } from '../../../lib/apiClient';
import { showNotification } from '../../../contexts/NotificationContext';
import { db } from '../../../lib/db';
import { Card, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ar } from 'date-fns/locale';
import { formatTimeTo12Hour, formatDateTimeTo12Hour } from '../../../lib/timeFormat';
import { Filter, RotateCcw } from 'lucide-react';
import { safeTranslateStatus } from '../../../lib/safeTranslation';

const PAGE_SIZE = 25;

type BookingReportPaymentWay = 'package_covered' | 'paid_onsite' | 'bank_transfer' | 'unpaid';

type BookingReportRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  payment_method: string;
  payment_way?: BookingReportPaymentWay;
  created_at: string | null;
  slot_date: string;
  start_time: string;
  service_name: string;
  service_name_ar?: string;
  employee_name: string | null;
  branch_name: string;
  package_covered_quantity: number;
};

function effectivePaymentWay(r: BookingReportRow): BookingReportPaymentWay {
  if (r.payment_way) return r.payment_way;
  if (Number(r.package_covered_quantity ?? 0) > 0) return 'package_covered';
  return 'unpaid';
}

function paymentWayLabel(t: (key: string, defaultValue?: string) => string, way: BookingReportPaymentWay): string {
  switch (way) {
    case 'package_covered':
      return t('reports.bookings.paymentWay.packageCovered', 'Package (covered)');
    case 'paid_onsite':
      return t('payment.displayPaidOnSite', 'Paid On Site');
    case 'bank_transfer':
      return t('payment.displayBankTransfer', 'Bank Transfer');
    default:
      return t('payment.displayUnpaid', 'Unpaid');
  }
}

export function ReportsBookingsPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<BookingReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [total, setTotal] = useState(0);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchId, setBranchId] = useState('all');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [services, setServices] = useState<{ id: string; name: string; name_ar?: string }[]>([]);
  const [status, setStatus] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ id: string; full_name: string; full_name_ar?: string }[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);

  const isAr = i18n.language === 'ar';

  const buildQs = useCallback(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(PAGE_SIZE));
    if (startDate) p.set('startDate', startDate);
    if (endDate) p.set('endDate', endDate);
    if (branchId && branchId !== 'all') p.set('branch_id', branchId);
    else p.set('branch_id', 'all');
    if (serviceId) p.set('service_id', serviceId);
    if (status) p.set('status', status);
    if (employeeId) p.set('employee_id', employeeId);
    return p.toString();
  }, [page, startDate, endDate, branchId, serviceId, status, employeeId]);

  const load = useCallback(async () => {
    if (!userProfile?.tenant_id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/reports/bookings?${buildQs()}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      const pg = data.pagination || {};
      const nextTotalPages = Math.max(1, Number(pg.totalPages) || 1);
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }

      setRows(data.data || []);
      setTotalPages(nextTotalPages);
      setHasNext(!!pg.hasNextPage);
      setHasPrev(!!pg.hasPrevPage);
      setTotal(pg.total ?? 0);
    } catch (e: any) {
      console.error(e);
      setRows([]);
      showNotification('error', e.message);
    } finally {
      setLoading(false);
    }
  }, [userProfile?.tenant_id, buildQs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    db.from('services')
      .select('id, name, name_ar')
      .eq('tenant_id', userProfile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .then((res: any) => setServices(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setServices([]));
  }, [userProfile?.tenant_id]);

  useEffect(() => {
    if (userProfile?.role !== 'tenant_admin' && userProfile?.role !== 'admin_user' && userProfile?.role !== 'customer_admin') return;
    apiFetch('/branches', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.data || []))
      .catch(() => setBranches([]));
  }, [userProfile?.role]);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    apiFetch('/reports/filter-employees?for=booking', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees((d.employees || []) as any[]))
      .catch(() => setEmployees([]));
  }, [userProfile?.tenant_id]);

  const reset = () => {
    setStartDate('');
    setEndDate('');
    setBranchId('all');
    setServiceId('');
    setStatus('');
    setEmployeeId('');
    setPage(1);
  };

  const apply = () => {
    setPage(1);
    if (page === 1) {
      load();
    }
  };

  useEffect(() => {
    // If user is on page > 1, any filter change should start from first page.
    setPage((prev) => (prev === 1 ? prev : 1));
  }, [startDate, endDate, branchId, serviceId, status, employeeId]);

  const exportFile = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      let qs = buildQs().replace(/^page=\d+&?|&?limit=\d+/g, '').replace(/&&/g, '&').replace(/^&|&$/g, '');
      const url = `${getApiUrl()}/reports/bookings/export/${format}?${qs}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const blob = await res.blob();
      const ext = format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv';
      const u = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `bookings-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(u);
    } catch (e: any) {
      showNotification('error', e.message || t('common.exportFailed'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('reports.bookings.title', 'Bookings report')}</h2>
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.startDate', 'Start Date')}</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.endDate', 'End Date')}</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            {(userProfile?.role === 'tenant_admin' || userProfile?.role === 'admin_user' || userProfile?.role === 'customer_admin') &&
              branches.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.branch', 'Branch')}</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                  >
                    <option value="all">{t('visitors.allBranches', 'All Branches')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.service', 'Service')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">{t('visitors.allServices', 'All Services')}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {i18n.language === 'ar' ? s.name_ar || s.name : s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.bookingStatus', 'Booking Status')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">{t('visitors.allStatuses', 'All')}</option>
                <option value="confirmed">{t('booking.statusConfirmed', 'Confirmed')}</option>
                <option value="pending">{t('booking.statusPending', 'Pending')}</option>
                <option value="cancelled">{t('booking.statusCancelled', 'Cancelled')}</option>
                <option value="checked_in">{t('booking.statusCheckedIn', 'Checked-in')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.bookings.filterEmployee', 'Employee')}
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">{t('reports.bookings.allEmployeesOption', 'All')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {i18n.language === 'ar' ? e.full_name_ar || e.full_name : e.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button variant="primary" icon={<Filter className="w-4 h-4" />} onClick={apply}>
              {t('visitors.filter', 'Filter')}
            </Button>
            <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={reset}>
              {t('visitors.reset', 'Reset')}
            </Button>
            <div className="flex gap-1 ml-auto flex-wrap">
              <Button variant="secondary" size="sm" disabled={!!exporting} onClick={() => exportFile('csv')}>
                {exporting === 'csv' ? '…' : t('visitors.exportCsv', 'CSV')}
              </Button>
              <Button variant="secondary" size="sm" disabled={!!exporting} onClick={() => exportFile('xlsx')}>
                {exporting === 'xlsx' ? '…' : t('visitors.exportExcel', 'Excel')}
              </Button>
              <Button variant="secondary" size="sm" disabled={!!exporting} onClick={() => exportFile('pdf')}>
                {exporting === 'pdf' ? '…' : t('visitors.exportPdf', 'PDF')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="px-4 py-3 border-b text-sm text-gray-600">
            {total} {t('reports.records', 'records')}
          </div>
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <table className="w-full min-w-[1180px] text-sm" dir={isAr ? 'rtl' : 'ltr'}>
              <thead className="bg-slate-100 text-start text-xs font-semibold text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2">{t('reports.bookings.col.date', 'Date')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.bookingCreated', 'Booking created')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.service', 'Service')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.customer', 'Customer')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.status', 'Status')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.paymentWay', 'Payment way')}</th>
                  <th className="px-3 py-2 text-end">{t('reports.bookings.col.amount', 'Amount')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.employee', 'Employee')}</th>
                  <th className="px-3 py-2">{t('reports.bookings.col.branch', 'Branch')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-start" dir="ltr">
                      <div className="tabular-nums">{r.slot_date || '—'}</div>
                      <div className="text-xs text-gray-500 tabular-nums">
                        {r.start_time ? formatTimeTo12Hour(r.start_time) : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap" dir="ltr">
                      {r.created_at
                        ? formatDateTimeTo12Hour(r.created_at, { locale: isAr ? ar : undefined })
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-start">
                      {i18n.language === 'ar' ? r.service_name_ar || r.service_name : r.service_name}
                    </td>
                    <td className="px-3 py-2 text-start">
                      <div className="font-medium">{r.customer_name}</div>
                      <div className="text-xs text-gray-500 tabular-nums text-start" dir="ltr">
                        {r.customer_phone || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-start">{safeTranslateStatus(t, r.status)}</td>
                    <td className="px-3 py-2 text-xs text-start">{paymentWayLabel(t, effectivePaymentWay(r))}</td>
                    <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                      {formatPrice(r.total_price)}
                    </td>
                    <td className="px-3 py-2 text-start">{r.employee_name || '—'}</td>
                    <td className="px-3 py-2 text-start">{r.branch_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-center py-12 text-gray-500">{t('reports.noData', 'No data for these filters')}</div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <span className="text-sm text-gray-600">
                {t('common.page', 'Page')} {page} / {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={!hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {t('common.previous', 'Previous')}
                </Button>
                <Button variant="secondary" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                  {t('common.next', 'Next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
