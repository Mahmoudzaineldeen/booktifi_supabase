/**
 * Receptionist Visitors Page
 * Same backend APIs as admin Visitors page; reception UI layout and styling.
 * Does NOT import admin VisitorsPage or TenantLayout.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import {
  Download,
  Filter,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Ban,
  CheckCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { safeTranslateStatus } from '../../lib/safeTranslation';

const PAGE_SIZE = 20;

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface VisitorRow {
  id: string;
  type: 'customer' | 'guest';
  customer_name: string;
  phone: string;
  email: string | null;
  total_bookings: number;
  total_spent: number;
  total_paid_on_site?: number;
  total_paid_by_transfer?: number;
  package_bookings_count: number;
  paid_bookings_count: number;
  last_booking_date: string | null;
  status: 'active' | 'blocked';
}

interface VisitorDetailBooking {
  id: string;
  service_name: string;
  date: string;
  time: string;
  visitors_count: number;
  booking_type: 'PACKAGE' | 'PAID';
  amount_paid: number;
  status: string;
  created_by: string;
  payment_method?: string | null;
  transaction_reference?: string | null;
}

interface VisitorDetail {
  visitor: {
    id: string;
    type: 'customer' | 'guest';
    customer_name: string;
    phone: string;
    email: string | null;
    total_bookings: number;
    total_spent: number;
    package_bookings_count: number;
    paid_bookings_count: number;
    last_booking_date: string | null;
    status: string;
    active_packages: any[];
  };
  bookings: VisitorDetailBooking[];
}

export function ReceptionVisitorsPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();

  const [visitors, setVisitors] = useState<VisitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [summary, setSummary] = useState({
    totalBookings: 0,
    totalPackageBookings: 0,
    totalPaidBookings: 0,
    totalSpent: 0,
    totalPaidOnSite: 0,
    totalPaidByTransfer: 0,
  });

  const [nameFilter, setNameFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [bookingType, setBookingType] = useState<'all' | 'package_only' | 'paid_only'>('all');
  const [serviceId, setServiceId] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');
  const [services, setServices] = useState<{ id: string; name: string; name_ar?: string }[]>([]);

  const [detailVisitor, setDetailVisitor] = useState<VisitorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportIncludeTotals, setExportIncludeTotals] = useState(true);
  const [exportIncludeVisitorDetails, setExportIncludeVisitorDetails] = useState(true);
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  const [showExportDetailsMenu, setShowExportDetailsMenu] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<VisitorRow | null>(null);

  const canBlockUnblock = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator'].includes(
    userProfile?.role || ''
  );

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(pagination.page));
    params.set('limit', String(PAGE_SIZE));
    if (nameFilter.trim()) params.set('name', nameFilter.trim());
    if (phoneFilter.trim()) params.set('phone', phoneFilter.trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (bookingType !== 'all') params.set('bookingType', bookingType);
    if (serviceId) params.set('serviceId', serviceId);
    if (bookingStatus) params.set('bookingStatus', bookingStatus);
    return params.toString();
  }, [pagination.page, nameFilter, phoneFilter, startDate, endDate, bookingType, serviceId, bookingStatus]);

  const fetchVisitors = useCallback(async () => {
    if (!userProfile?.tenant_id) return;
    setLoading(true);
    try {
      const qs = buildQuery();
      const res = await fetch(`${getApiUrl()}/visitors?${qs}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load visitors');
      setVisitors(data.data || []);
      setPagination((prev) => ({
        ...prev,
        ...(data.pagination || {}),
      }));
      setSummary({
        totalBookings: data.summary?.totalBookings ?? 0,
        totalPackageBookings: data.summary?.totalPackageBookings ?? 0,
        totalPaidBookings: data.summary?.totalPaidBookings ?? 0,
        totalSpent: data.summary?.totalSpent ?? 0,
        totalPaidOnSite: data.summary?.totalPaidOnSite ?? 0,
        totalPaidByTransfer: data.summary?.totalPaidByTransfer ?? 0,
      });
    } catch (e: any) {
      console.error('Fetch visitors error', e);
      setVisitors([]);
    } finally {
      setLoading(false);
    }
  }, [userProfile?.tenant_id, buildQuery]);

  useEffect(() => {
    fetchVisitors();
  }, [fetchVisitors]);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    db.from('services')
      .select('id, name, name_ar')
      .eq('tenant_id', userProfile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .then((res: { data?: any[] } | any) => setServices(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setServices([]));
  }, [userProfile?.tenant_id]);

  const handleFilter = () => {
    setPagination((p) => ({ ...p, page: 1 }));
    setTimeout(() => fetchVisitors(), 0);
  };

  const handleReset = () => {
    setNameFilter('');
    setPhoneFilter('');
    setStartDate('');
    setEndDate('');
    setBookingType('all');
    setServiceId('');
    setBookingStatus('');
    setPagination((p) => ({ ...p, page: 1 }));
    setTimeout(() => fetchVisitors(), 0);
  };

  const openDetail = async (row: VisitorRow) => {
    setDetailLoading(true);
    setDetailVisitor(null);
    try {
      const res = await fetch(`${getApiUrl()}/visitors/${encodeURIComponent(row.id)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load visitor');
      setDetailVisitor(data);
    } catch (e: any) {
      console.error('Visitor detail error', e);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailVisitor(null);
    setConfirmBlock(null);
  };

  const handleBlock = async (row: VisitorRow) => {
    if (row.type === 'guest' || row.status === 'blocked') return;
    setConfirmBlock(row);
  };

  const confirmBlockYes = async () => {
    if (!confirmBlock || confirmBlock.type === 'guest') return;
    setBlockingId(confirmBlock.id);
    try {
      const res = await fetch(`${getApiUrl()}/visitors/${confirmBlock.id}/block`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to block');
      setConfirmBlock(null);
      if (detailVisitor?.visitor.id === confirmBlock.id) {
        setDetailVisitor((d) =>
          d ? { ...d, visitor: { ...d.visitor, status: 'blocked' } } : null
        );
      }
      fetchVisitors();
    } catch (e: any) {
      console.error(e);
      showNotification('error',e.message || 'Failed to block visitor');
    } finally {
      setBlockingId(null);
    }
  };

  const handleUnblock = async (row: VisitorRow) => {
    if (row.type === 'guest' || row.status !== 'blocked') return;
    setBlockingId(row.id);
    try {
      const res = await fetch(`${getApiUrl()}/visitors/${row.id}/unblock`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unblock');
      if (detailVisitor?.visitor.id === row.id) {
        setDetailVisitor((d) =>
          d ? { ...d, visitor: { ...d.visitor, status: 'active' } } : null
        );
      }
      fetchVisitors();
    } catch (e: any) {
      console.error(e);
      showNotification('error', e.message || t('common.failedToUnblockVisitor'));
    } finally {
      setBlockingId(null);
    }
  };

  const handleExport = async (format: 'pdf' | 'csv' | 'xlsx') => {
    setExportingFormat(format);
    setShowExportMenu(false);
    let qs = buildQuery().replace(/^page=\d+&?|&?limit=\d+/g, '').replace(/&&/g, '&').replace(/^&|&$/g, '');
    if (qs) qs += '&';
    qs += `includeTotals=${exportIncludeTotals ? '1' : '0'}&includeVisitorDetails=${exportIncludeVisitorDetails ? '1' : '0'}`;
    const url = `${getApiUrl()}/visitors/export/${format}?${qs}`;
    try {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const blob = await res.blob();
      const ext = format === 'csv' ? 'csv' : format === 'xlsx' ? 'xlsx' : 'pdf';
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `visitors-${new Date().toISOString().slice(0, 10)}.${ext}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      console.error('Export error', e);
      showNotification('error', e.message || t('common.exportFailed'));
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportDetails = async (format: 'pdf' | 'csv' | 'xlsx', visitorId: string | null) => {
    setExportingFormat(format);
    setShowExportDetailsMenu(false);
    let qs = buildQuery().replace(/^page=\d+&?|&?limit=\d+/g, '').replace(/&&/g, '&').replace(/^&|&$/g, '');
    if (qs) qs += '&';
    qs += `detail=1&includeTotals=1&includeVisitorDetails=1`;
    if (visitorId) qs += `&visitorId=${encodeURIComponent(visitorId)}`;
    const url = `${getApiUrl()}/visitors/export/${format}?${qs}`;
    try {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const blob = await res.blob();
      const ext = format === 'csv' ? 'csv' : format === 'xlsx' ? 'xlsx' : 'pdf';
      const suffix = visitorId ? '-visitor' : '';
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `visitor-details${suffix}-${new Date().toISOString().slice(0, 10)}.${ext}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      console.error('Export details error', e);
      showNotification('error', e.message || t('common.exportFailed'));
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Reception-style: section header with export */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('navigation.visitors', 'Visitors')}</h2>
          <p className="text-sm text-gray-600">{t('visitors.subtitle', 'Manage and export visitor data')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="primary"
              size="sm"
              icon={<Download className="w-4 h-4" />}
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!!exportingFormat}
            >
              {exportingFormat ? t('common.loading', 'Loading...') : t('visitors.exportReport', 'Export Report')}
            </Button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} aria-hidden="true" />
                <div className="absolute right-0 mt-1 py-2 px-3 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20 space-y-2">
                  <div className="space-y-2 border-b border-gray-100 pb-2">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportIncludeTotals}
                        onChange={(e) => setExportIncludeTotals(e.target.checked)}
                        className="rounded border-gray-300 mt-0.5"
                      />
                      <span>
                        {t('visitors.exportIncludeTotals', 'Include summary totals')}
                        <span className="block text-xs text-gray-500 mt-0.5">
                          ({t('visitors.exportIncludeTotalsHint', 'Total Visitors, Total Bookings, Package Bookings, Total Spent')})
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportIncludeVisitorDetails}
                        onChange={(e) => setExportIncludeVisitorDetails(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      {t('visitors.exportIncludeVisitorDetails', "Include each visitor's details")}
                    </label>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 rounded"
                      onClick={() => handleExport('csv')}
                    >
                      {t('visitors.exportCsv', 'CSV')}
                    </button>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 rounded"
                      onClick={() => handleExport('xlsx')}
                    >
                      {t('visitors.exportExcel', 'Excel (.xlsx)')}
                    </button>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 rounded"
                      onClick={() => handleExport('pdf')}
                    >
                      {t('visitors.exportPdf', 'PDF')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <Button
              variant="primary"
              size="sm"
              icon={<Download className="w-4 h-4" />}
              onClick={() => { setShowExportDetailsMenu(!showExportDetailsMenu); setShowExportMenu(false); }}
              disabled={!!exportingFormat}
            >
              {t('visitors.exportDetails', 'Export visitor details')}
            </Button>
            {showExportDetailsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportDetailsMenu(false)} aria-hidden="true" />
                <div className="absolute right-0 mt-1 py-2 px-3 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-20 space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider pb-1 border-b">
                    {t('visitors.exportDetailsScope', 'Download')}
                  </p>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600">
                      {t('visitors.exportSelectedVisitor', 'Selected visitor')}
                      {selectedVisitorId && visitors.find((v) => v.id === selectedVisitorId) && (
                        <span className="block text-xs text-gray-500 truncate mt-0.5">
                          ({visitors.find((v) => v.id === selectedVisitorId)!.customer_name})
                        </span>
                      )}
                    </p>
                    <div className="flex gap-1 flex-wrap">
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => selectedVisitorId && handleExportDetails('csv', selectedVisitorId)}
                        disabled={!selectedVisitorId}
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => selectedVisitorId && handleExportDetails('xlsx', selectedVisitorId)}
                        disabled={!selectedVisitorId}
                      >
                        Excel
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => selectedVisitorId && handleExportDetails('pdf', selectedVisitorId)}
                        disabled={!selectedVisitorId}
                      >
                        PDF
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 pt-2 border-t">
                    <p className="text-sm text-gray-600">{t('visitors.exportAllVisitors', 'All visitors')}</p>
                    <div className="flex gap-1 flex-wrap">
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        onClick={() => handleExportDetails('csv', null)}
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        onClick={() => handleExportDetails('xlsx', null)}
                      >
                        Excel
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        onClick={() => handleExportDetails('pdf', null)}
                      >
                        PDF
                      </button>
                    </div>
                  </div>
                  {!selectedVisitorId && (
                    <p className="text-xs text-amber-600 pt-1">
                      {t('visitors.selectVisitorHint', 'Select a visitor in the table to download only that visitor.')}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters - reception style (similar to reception search bar) */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.searchByName', 'Search by Name')}</label>
              <Input
                placeholder={t('visitors.enterName', 'Enter name')}
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.searchByPhone', 'Search by Phone')}</label>
              <Input
                placeholder={t('visitors.enterPhone', 'Enter phone number')}
                value={phoneFilter}
                onChange={(e) => setPhoneFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.startDate', 'Start Date')}</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.endDate', 'End Date')}</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.paymentTypeFilter', 'Payment type (Package vs Paid)')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                value={bookingType}
                onChange={(e) => setBookingType(e.target.value as any)}
              >
                <option value="all">{t('visitors.allTypes', 'All types')}</option>
                <option value="package_only">{t('visitors.packageBookingsOnly', 'Package bookings only')}</option>
                <option value="paid_only">{t('visitors.paidBookingsOnly', 'Paid bookings only')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.service', 'Service')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">{t('visitors.allServices', 'All Services')}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{i18n.language === 'ar' ? s.name_ar || s.name : s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('visitors.bookingStatus', 'Booking Status')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                value={bookingStatus}
                onChange={(e) => setBookingStatus(e.target.value)}
              >
                <option value="">{t('visitors.allStatuses', 'All')}</option>
                <option value="confirmed">{t('booking.statusConfirmed', 'Confirmed')}</option>
                <option value="pending">{t('booking.statusPending', 'Pending')}</option>
                <option value="cancelled">{t('booking.statusCancelled', 'Cancelled')}</option>
                <option value="checked_in">{t('booking.statusCheckedIn', 'Checked-in')}</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="primary" size="sm" icon={<Filter className="w-4 h-4" />} onClick={handleFilter}>
              {t('visitors.filter', 'Filter')}
            </Button>
            <Button variant="secondary" size="sm" icon={<RotateCcw className="w-4 h-4" />} onClick={handleReset}>
              {t('visitors.reset', 'Reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards - reception style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-white border border-gray-200">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.totalVisitors', 'Total Visitors')}</p>
            <p className="text-xl font-bold text-gray-900">{pagination.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-green-200 bg-green-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.totalBookings', 'Total Bookings')}</p>
            <p className="text-xl font-bold text-green-800">{summary.totalBookings}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-amber-200 bg-amber-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.packageBookings', 'Package Bookings')}</p>
            <p className="text-xl font-bold text-amber-800">{summary.totalPackageBookings}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.totalSpent', 'Total Spent')}</p>
            <p className="text-xl font-bold text-blue-800">{formatPrice(summary.totalSpent)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-slate-200 bg-slate-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.totalPaidOnSite', 'Total Paid On Site')}</p>
            <p className="text-xl font-bold text-slate-800">{formatPrice(summary.totalPaidOnSite)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-gray-600">{t('visitors.totalPaidByTransfer', 'Total Paid by Transfer')}</p>
            <p className="text-xl font-bold text-indigo-800">{formatPrice(summary.totalPaidByTransfer)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Visitors list - table inside card (reception style) */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">{t('visitors.visitorList', 'Visitor List')}</h3>
            <span className="text-sm text-gray-500">{pagination.total} {t('visitors.records', 'records')}</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : visitors.length === 0 ? (
            <p className="text-center py-12 text-gray-500">{t('visitors.noVisitors', 'No visitors found matching your filters')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500 tracking-wider border-b border-gray-200">
                      <th className="px-4 py-3 w-10" title={t('visitors.selectForExport', 'Select for export')}>
                        <span className="sr-only">{t('visitors.selectForExport', 'Select for export')}</span>
                      </th>
                      <th className="px-4 py-3">{t('visitors.customerName', 'Customer Name')}</th>
                      <th className="px-4 py-3">{t('visitors.phone', 'Phone')}</th>
                      <th className="px-4 py-3">{t('visitors.email', 'Email')}</th>
                      <th className="px-4 py-3">{t('visitors.totalBookings', 'Total Bookings')}</th>
                      <th className="px-4 py-3">{t('visitors.totalSpent', 'Total Spent')}</th>
                      <th className="px-4 py-3">{t('visitors.packageBookings', 'Package')}</th>
                      <th className="px-4 py-3">{t('visitors.paidBookings', 'Paid')}</th>
                      <th className="px-4 py-3">{t('visitors.lastBooking', 'Last Booking')}</th>
                      <th className="px-4 py-3">{t('visitors.status', 'Status')}</th>
                      {canBlockUnblock && <th className="px-4 py-3">{t('common.actions', 'Actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visitors.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => openDetail(row)}
                        className={`border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer ${selectedVisitorId === row.id ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="radio"
                              name="export-visitor"
                              checked={selectedVisitorId === row.id}
                              onChange={() => setSelectedVisitorId(selectedVisitorId === row.id ? null : row.id)}
                              className="rounded-full border-gray-300 text-blue-600"
                            />
                          </label>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{row.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{row.phone}</td>
                        <td className="px-4 py-3 text-gray-600">{row.email || '—'}</td>
                        <td className="px-4 py-3">{row.total_bookings}</td>
                        <td className="px-4 py-3">{formatPrice(row.total_spent)}</td>
                        <td className="px-4 py-3">{row.package_bookings_count}</td>
                        <td className="px-4 py-3">{row.paid_bookings_count}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.last_booking_date ? format(parseISO(row.last_booking_date), 'MMM d, yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              row.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {row.status === 'blocked' ? t('visitors.blocked', 'Blocked') : t('visitors.active', 'Active')}
                          </span>
                        </td>
                        {canBlockUnblock && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            {row.type === 'guest' ? (
                              <span className="text-gray-400 text-xs">—</span>
                            ) : row.status === 'blocked' ? (
                              <Button
                                variant="primary"
                                size="sm"
                                icon={<CheckCircle className="w-3 h-3" />}
                                onClick={() => handleUnblock(row)}
                                disabled={blockingId === row.id}
                              >
                                {t('visitors.unblock', 'Unblock')}
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<Ban className="w-3 h-3" />}
                                onClick={() => handleBlock(row)}
                                disabled={blockingId === row.id}
                              >
                                {t('visitors.block', 'Block')}
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagination.totalPages > 1 && (
                <div className="flex justify-between items-center px-4 py-3 border-t border-gray-200">
                  <span className="text-sm text-gray-600">
                    {t('common.page', 'Page')} {pagination.page} {t('common.of', 'of')} {pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ChevronLeft className="w-4 h-4" />}
                      onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                      disabled={!pagination.hasPrevPage}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ChevronRight className="w-4 h-4" />}
                      onClick={() => setPagination((p) => ({ ...p, page: Math.min(pagination.totalPages, p.page + 1) }))}
                      disabled={!pagination.hasNextPage}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      <Modal
        isOpen={!!detailVisitor || detailLoading}
        onClose={closeDetail}
        title={detailVisitor ? detailVisitor.visitor.customer_name || detailVisitor.visitor.phone : (t('visitors.details', 'Visitor Details') as string)}
      >
        {detailLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : detailVisitor ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('visitors.visitorInfo', 'Visitor Info')}</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-gray-500">{t('visitors.name', 'Name')}</dt>
                <dd className="font-medium">{detailVisitor.visitor.customer_name || '—'}</dd>
                <dt className="text-gray-500">{t('visitors.phone', 'Phone')}</dt>
                <dd>{detailVisitor.visitor.phone}</dd>
                <dt className="text-gray-500">{t('visitors.email', 'Email')}</dt>
                <dd>{detailVisitor.visitor.email || '—'}</dd>
                <dt className="text-gray-500">{t('visitors.totalBookings', 'Total Bookings')}</dt>
                <dd>{detailVisitor.visitor.total_bookings}</dd>
                <dt className="text-gray-500">{t('visitors.totalSpent', 'Total Spent')}</dt>
                <dd>{formatPrice(detailVisitor.visitor.total_spent)}</dd>
                <dt className="text-gray-500">{t('visitors.packageBookings', 'Package Bookings')}</dt>
                <dd>{detailVisitor.visitor.package_bookings_count}</dd>
                <dt className="text-gray-500">{t('visitors.paidBookings', 'Paid Bookings')}</dt>
                <dd>{detailVisitor.visitor.paid_bookings_count}</dd>
              </dl>
              {detailVisitor.visitor.active_packages?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-500">{t('visitors.activePackages', 'Active packages')}</p>
                  <ul className="text-sm text-gray-700 mt-1">
                    {detailVisitor.visitor.active_packages.map((p: any, i: number) => (
                      <li key={i}>
                        {p.package_name || 'Package'} — {Array.isArray(p.usage) ? p.usage.map((u: any) => `${u.remaining_quantity || 0} left`).join(', ') : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {canBlockUnblock && detailVisitor.visitor.type === 'customer' && (
                <div className="mt-4 flex gap-2">
                  {detailVisitor.visitor.status === 'blocked' ? (
                    <Button variant="primary" size="sm" icon={<CheckCircle className="w-4 h-4" />} onClick={() => handleUnblock({ ...detailVisitor.visitor, id: detailVisitor.visitor.id } as VisitorRow)} disabled={blockingId === detailVisitor.visitor.id}>
                      {t('visitors.unblock', 'Unblock Visitor')}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" icon={<Ban className="w-4 h-4" />} onClick={() => handleBlock({ ...detailVisitor.visitor, id: detailVisitor.visitor.id } as VisitorRow)} disabled={blockingId === detailVisitor.visitor.id}>
                      {t('visitors.block', 'Block Visitor')}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('visitors.bookingHistory', 'Booking History')}</h3>
              <div className="overflow-x-auto max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.bookingId', 'Booking ID')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.serviceName', 'Service')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.date', 'Date')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.time', 'Time')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.visitorsCount', 'Visitors')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.paymentType', 'Payment type')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.amountPaid', 'Amount')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.status', 'Status')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.createdBy', 'Created By')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.paymentMethod', 'Payment Method')}</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">{t('visitors.transactionReference', 'Transaction Reference')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailVisitor.bookings.map((b) => (
                      <tr key={b.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs">{b.id.slice(0, 8)}…</td>
                        <td className="px-3 py-2">{b.service_name}</td>
                        <td className="px-3 py-2">{b.date || '—'}</td>
                        <td className="px-3 py-2">{b.time || '—'}</td>
                        <td className="px-3 py-2">{b.visitors_count}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${b.booking_type === 'PACKAGE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                            {b.booking_type}
                          </span>
                        </td>
                        <td className="px-3 py-2">{formatPrice(b.amount_paid)}</td>
                        <td className="px-3 py-2">{safeTranslateStatus(t, b.status)}</td>
                        <td className="px-3 py-2">{b.created_by === 'staff' ? t('visitors.staff', 'Admin/Receptionist') : t('visitors.customer', 'Customer')}</td>
                        <td className="px-3 py-2">{b.payment_method || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{b.transaction_reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Block confirmation */}
      <Modal isOpen={!!confirmBlock} onClose={() => setConfirmBlock(null)} title={t('visitors.confirmBlock', 'Block Visitor')}>
        {confirmBlock && (
          <div className="space-y-4">
            <p className="text-gray-600">{t('visitors.confirmBlockMessage', 'Blocking this visitor will prevent them from creating new bookings from the customer side. Past bookings will remain visible. Continue?')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmBlock(null)}>{t('common.cancel', 'Cancel')}</Button>
              <Button variant="primary" onClick={confirmBlockYes} disabled={blockingId !== null}>{t('visitors.block', 'Block Visitor')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
