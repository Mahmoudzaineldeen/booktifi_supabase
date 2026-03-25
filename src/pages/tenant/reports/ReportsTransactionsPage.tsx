import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../contexts/AuthContext';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { getApiUrl } from '../../../lib/apiUrl';
import { apiFetch, getAuthHeaders } from '../../../lib/apiClient';
import { showNotification } from '../../../contexts/NotificationContext';
import { Card, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Filter, RotateCcw } from 'lucide-react';

const PAGE_SIZE = 25;

type TxRow = {
  id: string;
  transaction_type: string;
  date: string;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  payment_method: string;
  booking_id: string | null;
  package_name: string | null;
  service_name: string;
  employee_name: string | null;
  branch_name: string;
};

export function ReportsTransactionsPage() {
  const { t } = useTranslation();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<TxRow[]>([]);
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
  const [paymentMethod, setPaymentMethod] = useState('');
  const [transactionType, setTransactionType] = useState<'all' | 'booking_payment' | 'package_purchase'>('all');
  const [exporting, setExporting] = useState<string | null>(null);

  const buildQs = useCallback(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(PAGE_SIZE));
    if (startDate) p.set('startDate', startDate);
    if (endDate) p.set('endDate', endDate);
    if (branchId && branchId !== 'all') p.set('branch_id', branchId);
    else p.set('branch_id', 'all');
    if (paymentMethod.trim()) p.set('payment_method', paymentMethod.trim());
    p.set('transaction_type', transactionType);
    return p.toString();
  }, [page, startDate, endDate, branchId, paymentMethod, transactionType]);

  const load = useCallback(async () => {
    if (!userProfile?.tenant_id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/reports/transactions?${buildQs()}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setRows(data.data || []);
      const pg = data.pagination || {};
      setTotalPages(pg.totalPages || 1);
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
    if (userProfile?.role !== 'tenant_admin' && userProfile?.role !== 'admin_user' && userProfile?.role !== 'customer_admin') return;
    apiFetch('/branches', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => setBranches(d.data || []))
      .catch(() => setBranches([]));
  }, [userProfile?.role]);

  const reset = () => {
    setStartDate('');
    setEndDate('');
    setBranchId('all');
    setPaymentMethod('');
    setTransactionType('all');
    setPage(1);
    setTimeout(() => load(), 0);
  };

  const apply = () => {
    setPage(1);
    setTimeout(() => load(), 0);
  };

  const exportFile = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      let qs = buildQs().replace(/^page=\d+&?|&?limit=\d+/g, '').replace(/&&/g, '&').replace(/^&|&$/g, '');
      const url = `${getApiUrl()}/reports/transactions/export/${format}?${qs}`;
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
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.${ext}`;
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
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('reports.transactions.title', 'Transactions report')}</h2>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('reports.transactions.type', 'Transaction type')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value as any)}
              >
                <option value="all">{t('visitors.allTypes', 'All')}</option>
                <option value="booking_payment">{t('reports.transactions.bookingPayments', 'Booking payments')}</option>
                <option value="package_purchase">{t('reports.transactions.packagePurchases', 'Package purchases')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('reports.transactions.paymentMethod', 'Payment method')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="">{t('visitors.allTypes', 'All')}</option>
                <option value="onsite">{t('payment.displayPaidOnSite', 'Paid On Site')}</option>
                <option value="transfer">{t('payment.displayBankTransfer', 'Bank Transfer')}</option>
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
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2">{t('reports.transactions.col.type', 'Type')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.date', 'Date')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.customer', 'Customer')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.amount', 'Amount')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.payment', 'Payment')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.booking', 'Booking')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.package', 'Package')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.employee', 'Employee')}</th>
                  <th className="px-3 py-2">{t('reports.transactions.col.branch', 'Branch')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">{r.transaction_type}</td>
                    <td className="px-3 py-2">{r.date}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.customer_name}</div>
                      <div className="text-xs text-gray-500">{r.customer_phone || '—'}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatPrice(r.amount)}</td>
                    <td className="px-3 py-2">{r.payment_method || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.booking_id ? r.booking_id.slice(0, 8) + '…' : '—'}</td>
                    <td className="px-3 py-2">{r.package_name || '—'}</td>
                    <td className="px-3 py-2">{r.employee_name || '—'}</td>
                    <td className="px-3 py-2">{r.branch_name || '—'}</td>
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
