import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Package, Users, Search, X, Calendar, Filter, FileSearch, Phone, Mail, CheckCircle, Briefcase, TrendingUp, TrendingDown, Hash, XCircle, AlertTriangle, Plus, Edit2, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { getApiUrl } from '../../lib/apiUrl';
import { getPaymentDisplayValue, PAYMENT_DISPLAY_KEYS, type PaymentDisplayValue } from '../../lib/paymentDisplay';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { ReceptionSubscribeModal } from '../../components/reception/ReceptionSubscribeModal';
import { SubscriptionConfirmationModal, type SubscriptionConfirmationData } from '../../components/shared/SubscriptionConfirmationModal';

interface PackageSubscriber {
  id: string;
  customer_id: string;
  package_id: string;
  zoho_invoice_id?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  transaction_reference?: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email?: string;
  };
  service_packages: {
    id: string;
    name: string;
    name_ar?: string;
  };
  usage: Array<{
    service_id: string;
    service_name: string;
    service_name_ar?: string;
    original_quantity: number;
    remaining_quantity: number;
    used_quantity: number;
  }>;
  subscribed_at: string;
  status: string;
}

type SearchType = 'customer_name' | 'customer_phone' | 'service_name' | 'package_name' | '';

export function PackageSubscribersPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const canAddSubscription = ['receptionist', 'admin_user', 'tenant_admin', 'customer_admin'].includes(userProfile?.role || '');
  const [subscribers, setSubscribers] = useState<PackageSubscriber[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin add subscription — exact clone: reuse ReceptionSubscribeModal (same UI + logic as reception)
  const [isAddSubscriptionModalOpen, setIsAddSubscriptionModalOpen] = useState(false);
  const [subscriptionConfirmationData, setSubscriptionConfirmationData] = useState<SubscriptionConfirmationData | null>(null);

  // Search state
  const [searchType, setSearchType] = useState<SearchType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PackageSubscriber[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState<string>('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Edit payment status modal — same three options as system: Unpaid | Paid On Site | Bank Transfer
  const [editingPaymentSubscription, setEditingPaymentSubscription] = useState<PackageSubscriber | null>(null);
  const [editPaymentDisplayValue, setEditPaymentDisplayValue] = useState<PaymentDisplayValue>('paid_onsite');
  const [editTransactionReference, setEditTransactionReference] = useState('');
  const [savingPaymentEdit, setSavingPaymentEdit] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscribers();
  }, [userProfile]);

  async function fetchSubscribers(opts?: { silent?: boolean }) {
    if (!userProfile?.tenant_id) return;

    try {
      if (!opts?.silent) setLoading(true);

      // Fetch all active package subscriptions with related data
      const { data, error } = await db
        .from('package_subscriptions')
        .select(`
          id,
          customer_id,
          package_id,
          status,
          subscribed_at,
          zoho_invoice_id,
          payment_status,
          payment_method,
          transaction_reference,
          customers (
            id,
            name,
            phone,
            email
          ),
          service_packages (
            id,
            name,
            name_ar
          )
        `)
        .eq('tenant_id', userProfile.tenant_id)
        .eq('status', 'active')
        .eq('is_active', true)
        .order('subscribed_at', { ascending: false });

      if (error) {
        console.error('Error fetching subscribers:', error);
        return;
      }

      if (!data) {
        setSubscribers([]);
        return;
      }

      // Fetch usage data for each subscription
      const subscribersWithUsage = await Promise.all(
        data.map(async (sub) => {
          const { data: usageData, error: usageError } = await db
            .from('package_subscription_usage')
            .select(`
              service_id,
              original_quantity,
              remaining_quantity,
              used_quantity,
              services (
                name,
                name_ar
              )
            `)
            .eq('subscription_id', sub.id);

          if (usageError) {
            console.error(`Error fetching usage for subscription ${sub.id}:`, usageError);
            return null;
          }

          const usage = (usageData || []).map((u: any) => ({
            service_id: u.service_id,
            service_name: u.services?.name || '',
            service_name_ar: u.services?.name_ar || '',
            original_quantity: u.original_quantity,
            remaining_quantity: u.remaining_quantity,
            used_quantity: u.used_quantity
          }));

          return {
            id: sub.id,
            customer_id: sub.customer_id,
            package_id: sub.package_id,
            zoho_invoice_id: (sub as any).zoho_invoice_id ?? null,
            payment_status: (sub as any).payment_status ?? null,
            payment_method: (sub as any).payment_method ?? null,
            transaction_reference: (sub as any).transaction_reference ?? null,
            customer: sub.customers,
            service_packages: sub.service_packages,
            usage,
            subscribed_at: sub.subscribed_at,
            status: sub.status
          };
        })
      );

      setSubscribers(subscribersWithUsage.filter((s): s is PackageSubscriber => s !== null));
    } catch (error) {
      console.error('Error fetching subscribers:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    if (!searchQuery.trim() || !searchType) {
      setSearchValidationError(t('bookings.search.validation.required', 'Please select search type and enter query'));
      return;
    }

    setIsSearching(true);
    setShowSearchResults(true);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch();
    }, 300);
  }

  function performSearch() {
    if (!searchQuery.trim() || !searchType) return;

    const query = searchQuery.toLowerCase().trim();
    let results: PackageSubscriber[] = [];

    switch (searchType) {
      case 'customer_name':
        results = subscribers.filter(s => 
          s.customer?.name?.toLowerCase().includes(query)
        );
        break;
      case 'customer_phone':
        results = subscribers.filter(s => 
          s.customer?.phone?.includes(query)
        );
        break;
      case 'service_name':
        results = subscribers.filter(s => 
          s.usage.some(u => 
            (i18n.language === 'ar' ? u.service_name_ar : u.service_name)
              ?.toLowerCase().includes(query)
          )
        );
        break;
      case 'package_name':
        results = subscribers.filter(s => 
          (i18n.language === 'ar' ? s.service_packages?.name_ar : s.service_packages?.name)
            ?.toLowerCase().includes(query)
        );
        break;
    }

    setSearchResults(results);
    setIsSearching(false);
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchType('');
    setShowSearchResults(false);
    setSearchResults([]);
    setSearchValidationError('');
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  }

  async function handleCancelSubscription(subscriptionId: string) {
    const ok = await showConfirm({
title: t('common.confirm'),
      description: t('packages.confirmCancelSubscription'),
      destructive: true,
      confirmText: t('packages.yesCancel'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    try {
      setCancellingId(subscriptionId);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/packages/subscriptions/${subscriptionId}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        let errorMessage = 'Failed to cancel subscription';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorData.message || errorMessage;
          console.error('[Cancel Subscription] Server error:', {
            status: response.status,
            error: errorData.error,
            details: errorData.details,
            code: errorData.code,
            hint: errorData.hint
          });
        } catch (parseError) {
          const text = await response.text();
          console.error('[Cancel Subscription] Non-JSON error response:', text.substring(0, 200));
          errorMessage = `Server error (${response.status}): ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      // Remove from UI immediately so the row disappears without refresh
      setSubscribers((prev) => prev.filter((s) => s.id !== subscriptionId));
      setSearchResults((prev) => prev.filter((s) => s.id !== subscriptionId));
      showNotification('success', t('packages.subscriptionCancelledSuccessfully'));
      await fetchSubscribers({ silent: true });
    } catch (error: any) {
      console.error('Error cancelling subscription:', error);
      showNotification('error', t('packages.errorCancellingSubscription', { message: error.message }));
    } finally {
      setCancellingId(null);
    }
  }

  function openEditPaymentModal(sub: PackageSubscriber) {
    setEditingPaymentSubscription(sub);
    setEditPaymentDisplayValue(getPaymentDisplayValue({ payment_status: sub.payment_status, payment_method: sub.payment_method }));
    setEditTransactionReference(sub.transaction_reference || '');
  }

  async function saveEditPayment() {
    if (!editingPaymentSubscription) return;
    if (editPaymentDisplayValue === 'bank_transfer' && !editTransactionReference.trim()) {
      showNotification('warning', t('reception.transactionReferenceRequired'));
      return;
    }
    try {
      setSavingPaymentEdit(true);
      // Package subscriptions API expects payment_status: 'paid' | 'pending' | 'failed' (not unpaid/paid_manual)
      const payment_status = editPaymentDisplayValue === 'unpaid' ? 'pending' : 'paid';
      const payment_method = editPaymentDisplayValue === 'unpaid' ? undefined : editPaymentDisplayValue === 'bank_transfer' ? 'transfer' : 'onsite';
      const token = localStorage.getItem('auth_token');
      const res = await fetch(
        `${getApiUrl()}/packages/subscriptions/${editingPaymentSubscription.id}/payment-status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            payment_status,
            payment_method,
            transaction_reference: editPaymentDisplayValue === 'bank_transfer' ? editTransactionReference.trim() : undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update payment status');
      setEditingPaymentSubscription(null);
      await fetchSubscribers({ silent: true });
      showNotification('success', t('packages.paymentStatusUpdated'));
      if (data.invoiceWarning) {
        showNotification('warning', data.invoiceWarning);
      }
    } catch (err: any) {
      console.error('Error updating payment status:', err);
      showNotification('error', err.message || t('common.failedToMarkAsPaid'));
    } finally {
      setSavingPaymentEdit(false);
    }
  }

  async function downloadSubscriptionInvoice(subscriptionId: string) {
    try {
      setDownloadingInvoiceId(subscriptionId);
      const token = localStorage.getItem('auth_token');
      const baseUrl = getApiUrl().replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/packages/subscriptions/${subscriptionId}/invoice/download`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `subscription-invoice-${subscriptionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Download subscription invoice error:', err);
      showNotification('error', t('common.failedToDownloadInvoice', { message: err.message }));
    } finally {
      setDownloadingInvoiceId(null);
    }
  }

  const displayData = showSearchResults ? searchResults : subscribers;

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">{t('common.loading') || 'Loading...'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {t('packages.subscribers.title', 'Package Subscribers')}
              </h1>
              <p className="text-sm md:text-base text-gray-600 mt-1">
                {t('packages.subscribers.subtitle', 'View customer package subscriptions and remaining capacity')}
              </p>
            </div>
          </div>
        </div>
        {canAddSubscription && (
          <Button
            onClick={() => setIsAddSubscriptionModalOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('packages.addSubscription', 'Add subscription')}
          </Button>
        )}
      </div>

      {/* Search Section */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <label className="flex items-center gap-2 text-base font-medium text-gray-700 mb-3">
                <Filter className="w-5 h-5" />
                {t('bookings.search.type', 'Search Type')}
              </label>
              <select
                value={searchType}
                onChange={(e) => {
                  setSearchType(e.target.value as SearchType);
                  setSearchValidationError('');
                }}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('bookings.search.selectType', 'Select search type')}</option>
                <option value="customer_name">{t('bookings.search.customerName', 'Customer Name')}</option>
                <option value="customer_phone">{t('bookings.search.customerPhone', 'Customer Phone')}</option>
                <option value="service_name">{t('bookings.search.serviceName', 'Service Name')}</option>
                <option value="package_name">{t('packages.search.packageName', 'Package Name')}</option>
              </select>
            </div>
            <div className="flex-[2]">
              <label className="flex items-center gap-2 text-base font-medium text-gray-700 mb-3">
                <FileSearch className="w-5 h-5" />
                {t('bookings.search.query', 'Search Query')}
              </label>
              <div className="flex gap-3">
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchValidationError('');
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    }
                  }}
                  placeholder={t('bookings.search.placeholder', 'Enter search term...')}
                  className="flex-1 text-base py-3 px-4"
                />
                <button
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="px-6 py-3 text-base bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
                >
                  <Search className="w-5 h-5" />
                  {t('bookings.search.search', 'Search')}
                </button>
                {showSearchResults && (
                  <button
                    onClick={clearSearch}
                    className="px-6 py-3 text-base bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center gap-2 font-medium"
                  >
                    <X className="w-5 h-5" />
                    {t('bookings.search.clear', 'Clear')}
                  </button>
                )}
              </div>
            </div>
          </div>
          {searchValidationError && (
            <p className="mt-2 text-sm text-red-600">{searchValidationError}</p>
          )}
          {showSearchResults && (
            <p className="mt-2 text-sm text-gray-600">
              {t('bookings.search.results', { count: searchResults.length, defaultValue: `Found ${searchResults.length} result(s)` }) || `Found ${searchResults.length} result(s)`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Subscribers List */}
      {displayData.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">
              {showSearchResults 
                ? t('packages.subscribers.noResults', 'No subscribers found matching your search')
                : t('packages.subscribers.empty', 'No active package subscriptions')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayData.map((subscriber) => (
            <Card key={subscriber.id}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        {subscriber.customer?.name || 'Unknown Customer'}
                      </h3>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-500" />
                        <span className="font-medium">{t('packages.subscribers.phone', 'Phone')}:</span>{' '}
                        {subscriber.customer?.phone || 'N/A'}
                      </p>
                      {subscriber.customer?.email && (
                        <p className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{t('packages.subscribers.email', 'Email')}:</span>{' '}
                          {subscriber.customer.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-600 mb-1">
                      <Calendar className="w-4 h-4 inline-block mr-1" />
                      {format(new Date(subscriber.subscribed_at), 'PP', {
                        locale: i18n.language === 'ar' ? ar : undefined
                      })}
                    </div>
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        subscriber.payment_status === 'paid' ? 'bg-green-100 text-green-800' :
                        subscriber.payment_status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        subscriber.payment_status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {t(PAYMENT_DISPLAY_KEYS[getPaymentDisplayValue({ payment_status: subscriber.payment_status, payment_method: subscriber.payment_method })])}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEditPaymentModal(subscriber)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium hover:bg-blue-200 transition-colors"
                        title={t('reception.editPaymentStatusTitle')}
                      >
                        <Edit2 className="w-3 h-3" />
                        {t('packages.editPayment')}
                      </button>
                      {subscriber.zoho_invoice_id && (
                        <button
                          type="button"
                          onClick={() => downloadSubscriptionInvoice(subscriber.id)}
                          disabled={downloadingInvoiceId === subscriber.id}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
                          title={i18n.language === 'ar' ? 'تنزيل الفاتورة' : 'Download invoice'}
                        >
                          {downloadingInvoiceId === subscriber.id ? (
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-800" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          {i18n.language === 'ar' ? 'تنزيل الفاتورة' : 'Download invoice'}
                        </button>
                      )}
                      <button
                        onClick={() => handleCancelSubscription(subscriber.id)}
                        disabled={cancellingId === subscriber.id}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title={t('packages.cancelSubscription')}
                      >
                        {cancellingId === subscriber.id ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-800"></div>
                            {t('packages.cancelling')}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            {t('common.cancel')}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="w-5 h-5 text-blue-600" />
                    <h4 className="font-semibold text-gray-900">
                      {i18n.language === 'ar' 
                        ? subscriber.service_packages?.name_ar 
                        : subscriber.service_packages?.name}
                    </h4>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Briefcase className="w-4 h-4" />
                      {t('packages.subscribers.services', 'Services & Capacity')}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {subscriber.usage.map((usage) => (
                        <div
                          key={usage.service_id}
                          className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <p className="font-medium text-gray-900 mb-2">
                            {i18n.language === 'ar' ? usage.service_name_ar : usage.service_name}
                          </p>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1 text-gray-600">
                                <TrendingUp className="w-3 h-3" />
                                {t('packages.subscribers.remaining', 'Remaining')}:
                              </span>
                              <span className="font-semibold text-blue-600">{usage.remaining_quantity}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1 text-gray-600">
                                <TrendingDown className="w-3 h-3" />
                                {t('packages.subscribers.used', 'Used')}:
                              </span>
                              <span className="text-gray-900">{usage.used_quantity}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1 text-gray-600">
                                <Hash className="w-3 h-3" />
                                {t('packages.subscribers.total', 'Total')}:
                              </span>
                              <span className="text-gray-900">{usage.original_quantity}</span>
                            </div>
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full transition-all"
                                  style={{
                                    width: `${(usage.remaining_quantity / usage.original_quantity) * 100}%`
                                  }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit payment status modal — same three options as system: Unpaid | Paid On Site | Bank Transfer */}
      <Modal
        isOpen={!!editingPaymentSubscription}
        onClose={() => setEditingPaymentSubscription(null)}
        title={t('reception.editPaymentStatusTitle')}
      >
        {editingPaymentSubscription && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {editingPaymentSubscription.customer?.name} — {i18n.language?.startsWith('ar') ? editingPaymentSubscription.service_packages?.name_ar : editingPaymentSubscription.service_packages?.name}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('booking.paymentStatus')}</label>
              <div className="flex flex-col gap-2">
                {(['unpaid', 'paid_onsite', 'bank_transfer'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editPaymentDisplay"
                      checked={editPaymentDisplayValue === value}
                      onChange={() => setEditPaymentDisplayValue(value)}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm">{t(PAYMENT_DISPLAY_KEYS[value])}</span>
                  </label>
                ))}
              </div>
              {editPaymentDisplayValue === 'bank_transfer' && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('reception.transactionReference')} *</label>
                  <Input
                    type="text"
                    value={editTransactionReference}
                    onChange={(e) => setEditTransactionReference(e.target.value)}
                    placeholder={t('reception.transactionReferencePlaceholder')}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={saveEditPayment} disabled={savingPaymentEdit}>
                {savingPaymentEdit ? t('common.saving') : t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => setEditingPaymentSubscription(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Admin Add Subscription — exact clone: reuse ReceptionSubscribeModal (same UI + logic as reception) */}
      <ReceptionSubscribeModal
        isOpen={isAddSubscriptionModalOpen}
        onClose={() => setIsAddSubscriptionModalOpen(false)}
        onSuccess={(data) => {
          setSubscriptionConfirmationData(data);
          fetchSubscribers();
        }}
      />

      {/* Subscription success confirmation — same style as booking confirmation */}
      <SubscriptionConfirmationModal
        isOpen={!!subscriptionConfirmationData}
        onClose={() => setSubscriptionConfirmationData(null)}
        data={subscriptionConfirmationData}
        onAddAnother={() => {
          setSubscriptionConfirmationData(null);
          setIsAddSubscriptionModalOpen(true);
        }}
      />
    </div>
  );
}
