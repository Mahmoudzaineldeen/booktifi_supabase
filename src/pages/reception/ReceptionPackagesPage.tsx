/**
 * Receptionist Packages Management Page
 * 
 * Two tabs:
 * 1. Available Packages - View and search packages, subscribe customers
 * 2. Package Subscribers - View and search subscribers
 * 
 * Receptionists can:
 * - View packages
 * - Search packages
 * - Subscribe customers to packages
 * - View subscribers
 * - Search subscribers
 * 
 * Receptionists CANNOT:
 * - Create packages
 * - Edit packages
 * - Delete packages
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { db } from '../../lib/db';
import { getApiUrl } from '../../lib/apiUrl';
import { getPaymentDisplayValue, displayValueToApiPayload, PAYMENT_DISPLAY_KEYS, type PaymentDisplayValue } from '../../lib/paymentDisplay';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Package, Users, Search, X, CheckCircle, AlertCircle, Phone, Mail, XCircle, Edit2, Download } from 'lucide-react';
import { ReceptionSubscribeModal } from '../../components/reception/ReceptionSubscribeModal';
import { SubscriptionConfirmationModal, type SubscriptionConfirmationData } from '../../components/shared/SubscriptionConfirmationModal';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface PackageService {
  service_id: string;
  service_name: string;
  service_name_ar?: string;
  capacity: number;
}

interface ReceptionistPackage {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  description_ar?: string;
  total_price: number;
  original_price?: number;
  discount_percentage?: number;
  is_active: boolean;
  services: PackageService[];
}

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
  package: {
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

type TabType = 'packages' | 'subscribers';

export function ReceptionPackagesPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const [activeTab, setActiveTab] = useState<TabType>('packages');
  
  // Packages state
  const [packages, setPackages] = useState<ReceptionistPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packageSearchQuery, setPackageSearchQuery] = useState('');
  const [packageSearchService, setPackageSearchService] = useState('');
  const [services, setServices] = useState<Array<{ id: string; name: string; name_ar?: string }>>([]);
  
  // Subscribers state
  const [subscribers, setSubscribers] = useState<PackageSubscriber[]>([]);
  const [subscribersLoading, setSubscribersLoading] = useState(true);
  const [subscriberSearchQuery, setSubscriberSearchQuery] = useState('');
  const [subscriberSearchType, setSubscriberSearchType] = useState<'customer_name' | 'customer_phone' | 'package_name' | 'service_name' | ''>('');
  const [subscriberPage, setSubscriberPage] = useState(1);
  const [subscriberTotalPages, setSubscriberTotalPages] = useState(1);
  
  // Subscribe Customer Modal — uses shared ReceptionSubscribeModal (same UI + logic as admin)
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [selectedPackageForSubscribe, setSelectedPackageForSubscribe] = useState<string | null>(null);
  const [subscriptionConfirmationData, setSubscriptionConfirmationData] = useState<SubscriptionConfirmationData | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editingPaymentSubscription, setEditingPaymentSubscription] = useState<PackageSubscriber | null>(null);
  const [editPaymentStatus, setEditPaymentStatus] = useState<string>('paid');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'onsite' | 'transfer'>('onsite');
  const [editTransactionReference, setEditTransactionReference] = useState('');
  const [savingPaymentEdit, setSavingPaymentEdit] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  // Fetch services for search filter
  useEffect(() => {
    async function fetchServices() {
      if (!userProfile?.tenant_id) return;
      
      try {
        const { data, error } = await db
          .from('services')
          .select('id, name, name_ar')
          .eq('tenant_id', userProfile.tenant_id)
          .eq('is_active', true)
          .order('name');
        
        if (error) {
          console.error('Error fetching services:', error);
          return;
        }
        
        setServices(data || []);
      } catch (error) {
        console.error('Error fetching services:', error);
      }
    }
    
    fetchServices();
  }, [userProfile]);

  // Fetch packages
  useEffect(() => {
    if (activeTab === 'packages') {
      fetchPackages();
    }
  }, [activeTab, userProfile, packageSearchQuery, packageSearchService]);

  // Fetch subscribers
  useEffect(() => {
    if (activeTab === 'subscribers') {
      fetchSubscribers();
    }
  }, [activeTab, userProfile, subscriberSearchQuery, subscriberSearchType, subscriberPage]);

  async function fetchPackages() {
    if (!userProfile?.tenant_id) {
      setPackages([]);
      setPackagesLoading(false);
      return;
    }

    try {
      setPackagesLoading(true);
      const token = localStorage.getItem('auth_token');
      
      const params = new URLSearchParams();
      if (packageSearchQuery.trim()) {
        params.append('search', packageSearchQuery.trim());
      }
      if (packageSearchService) {
        params.append('service_id', packageSearchService);
      }

      const response = await fetch(`${getApiUrl()}/packages/receptionist/packages?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch packages: ${response.statusText}`);
      }

      const data = await response.json();
      setPackages(data.packages || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
      setPackages([]);
    } finally {
      setPackagesLoading(false);
    }
  }

  async function fetchSubscribers() {
    if (!userProfile?.tenant_id) {
      setSubscribers([]);
      setSubscribersLoading(false);
      return;
    }

    try {
      setSubscribersLoading(true);
      const token = localStorage.getItem('auth_token');
      
      const params = new URLSearchParams();
      params.append('page', subscriberPage.toString());
      params.append('limit', '50');
      if (subscriberSearchQuery.trim() && subscriberSearchType) {
        params.append('search', subscriberSearchQuery.trim());
        params.append('search_type', subscriberSearchType);
      }

      const response = await fetch(`${getApiUrl()}/packages/receptionist/subscribers?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch subscribers: ${response.statusText}`);
      }

      const data = await response.json();
      setSubscribers(data.subscribers || []);
      setSubscriberTotalPages(data.pagination?.total_pages || 1);
    } catch (error) {
      console.error('Error fetching subscribers:', error);
      setSubscribers([]);
    } finally {
      setSubscribersLoading(false);
    }
  }

  function openSubscribeModal(packageId?: string) {
    setSelectedPackageForSubscribe(packageId || null);
    setIsSubscribeModalOpen(true);
  }

  async function handleCancelSubscription(subscriptionId: string) {
    const ok = await showConfirm({
      title: i18n.language === 'ar' ? 'تأكيد' : 'Confirm',
      description: i18n.language === 'ar'
        ? 'هل أنت متأكد من إلغاء هذه الاشتراك؟ لا يمكن التراجع عن هذا الإجراء.'
        : 'Are you sure you want to cancel this subscription? This action cannot be undone.',
      destructive: true,
      confirmText: i18n.language === 'ar' ? 'نعم، إلغاء' : 'Yes, cancel',
      cancelText: i18n.language === 'ar' ? 'إلغاء' : 'Cancel',
    });
    if (!ok) return;

    try {
      setCancellingId(subscriptionId);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${getApiUrl()}/packages/subscriptions/${subscriptionId}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || `Failed to cancel (${response.status})`);
      }
      setSubscribers((prev) => prev.filter((s) => s.id !== subscriptionId));
      showNotification('success', t('packages.subscriptionCancelledSuccessfully'));
      await fetchSubscribers();
    } catch (err: any) {
      console.error('Error cancelling subscription:', err);
      showNotification('error', t('packages.errorCancellingSubscription', { message: err.message }));
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
      const payload = displayValueToApiPayload(editPaymentDisplayValue);
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
            payment_status: payload.payment_status,
            payment_method: payload.payment_method,
            transaction_reference: editPaymentDisplayValue === 'bank_transfer' ? editTransactionReference.trim() : undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update payment status');
      setEditingPaymentSubscription(null);
      await fetchSubscribers();
      showNotification('success', t('packages.paymentStatusUpdated'));
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

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('packages')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'packages'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Package className="w-4 h-4 inline mr-2" />
          {i18n.language === 'ar' ? 'الباقات المتاحة' : 'Available Packages'}
        </button>
        <button
          onClick={() => setActiveTab('subscribers')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'subscribers'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          {i18n.language === 'ar' ? 'المشتركين' : 'Package Subscribers'}
        </button>
      </div>

      {/* Available Packages Tab */}
      {activeTab === 'packages' && (
        <div className="space-y-4">
          {/* Search Bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {i18n.language === 'ar' ? 'البحث عن الباقة' : 'Search Packages'}
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        type="text"
                        value={packageSearchQuery}
                        onChange={(e) => setPackageSearchQuery(e.target.value)}
                        placeholder={i18n.language === 'ar' ? 'اسم الباقة...' : 'Package name...'}
                        className="pl-10"
                      />
                      {packageSearchQuery && (
                        <button
                          onClick={() => setPackageSearchQuery('')}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="sm:w-64">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {i18n.language === 'ar' ? 'الخدمة' : 'Service'}
                    </label>
                    <select
                      value={packageSearchService}
                      onChange={(e) => setPackageSearchService(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">{i18n.language === 'ar' ? 'جميع الخدمات' : 'All Services'}</option>
                      {services.map(service => (
                        <option key={service.id} value={service.id}>
                          {i18n.language === 'ar' ? service.name_ar || service.name : service.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Packages List */}
          {packagesLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">{i18n.language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
            </div>
          ) : packages.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">
                  {i18n.language === 'ar' ? 'لا توجد باقات متاحة' : 'No packages available'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {packages.map((pkg) => (
                <Card key={pkg.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{i18n.language === 'ar' ? pkg.name_ar || pkg.name : pkg.name}</span>
                      <span className={`px-2 py-1 text-xs rounded ${
                        pkg.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {pkg.is_active 
                          ? (i18n.language === 'ar' ? 'نشط' : 'Active')
                          : (i18n.language === 'ar' ? 'معطل' : 'Disabled')
                        }
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {pkg.description && (
                      <p className="text-sm text-gray-600">
                        {i18n.language === 'ar' ? pkg.description_ar || pkg.description : pkg.description}
                      </p>
                    )}
                    
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        {i18n.language === 'ar' ? 'الخدمات المتضمنة' : 'Included Services'}:
                      </p>
                      <ul className="space-y-1">
                        {pkg.services.map((service, idx) => (
                          <li key={idx} className="text-sm text-gray-600">
                            • {i18n.language === 'ar' ? service.service_name_ar || service.service_name : service.service_name}
                            <span className="ml-2 text-gray-500">
                              ({service.capacity} {i18n.language === 'ar' ? 'تذكرة' : 'tickets'})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div>
                        <p className="text-lg font-bold text-gray-900">
                          {formatPrice(pkg.total_price)}
                        </p>
                        {pkg.original_price && pkg.original_price > pkg.total_price && (
                          <p className="text-sm text-gray-500 line-through">
                            {formatPrice(pkg.original_price)}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('[ReceptionPackagesPage] Subscribe button clicked for package:', pkg.id);
                          openSubscribeModal(pkg.id);
                        }}
                      >
                        {i18n.language === 'ar' ? 'اشترك عميل' : 'Subscribe Customer'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Package Subscribers Tab */}
      {activeTab === 'subscribers' && (
        <div className="space-y-4">
          {/* Search Bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="sm:w-48">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {i18n.language === 'ar' ? 'نوع البحث' : 'Search Type'}
                    </label>
                    <select
                      value={subscriberSearchType}
                      onChange={(e) => {
                        setSubscriberSearchType(e.target.value as any);
                        setSubscriberSearchQuery('');
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">{i18n.language === 'ar' ? 'جميع' : 'All'}</option>
                      <option value="customer_name">{i18n.language === 'ar' ? 'اسم العميل' : 'Customer Name'}</option>
                      <option value="customer_phone">{i18n.language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</option>
                      <option value="package_name">{i18n.language === 'ar' ? 'اسم الباقة' : 'Package Name'}</option>
                      <option value="service_name">{i18n.language === 'ar' ? 'اسم الخدمة' : 'Service Name'}</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {i18n.language === 'ar' ? 'البحث' : 'Search'}
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        type="text"
                        value={subscriberSearchQuery}
                        onChange={(e) => setSubscriberSearchQuery(e.target.value)}
                        placeholder={
                          subscriberSearchType === 'customer_name'
                            ? (i18n.language === 'ar' ? 'اسم العميل...' : 'Customer name...')
                            : subscriberSearchType === 'customer_phone'
                            ? (i18n.language === 'ar' ? 'رقم الهاتف...' : 'Phone number...')
                            : subscriberSearchType === 'package_name'
                            ? (i18n.language === 'ar' ? 'اسم الباقة...' : 'Package name...')
                            : subscriberSearchType === 'service_name'
                            ? (i18n.language === 'ar' ? 'اسم الخدمة...' : 'Service name...')
                            : (i18n.language === 'ar' ? 'اختر نوع البحث أولاً...' : 'Select search type first...')
                        }
                        className="pl-10"
                        disabled={!subscriberSearchType}
                      />
                      {subscriberSearchQuery && (
                        <button
                          onClick={() => {
                            setSubscriberSearchQuery('');
                            setSubscriberSearchType('');
                          }}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Subscribers Table */}
          {subscribersLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">{i18n.language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
            </div>
          ) : subscribers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">
                  {i18n.language === 'ar' ? 'لا يوجد مشتركين' : 'No subscribers found'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="overflow-x-auto" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
                <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'العميل' : 'Customer'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'الباقة' : 'Package'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'السعة المتبقية' : 'Remaining Capacity'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'المستهلك' : 'Consumed'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'تاريخ الاشتراك' : 'Subscription Date'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'حالة الدفع' : 'Payment'}
                      </th>
                      <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                        {i18n.language === 'ar' ? 'إجراءات' : 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {subscribers.map((subscriber) => (
                      <tr key={subscriber.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className={i18n.language === 'ar' ? 'text-right' : 'text-left'}>
                            <p className="text-sm font-medium text-gray-900">{subscriber.customer.name}</p>
                            <p className={`text-sm text-gray-500 flex items-center ${i18n.language === 'ar' ? 'flex-row-reverse justify-end' : 'flex-row'} gap-1`}>
                              <Phone className="w-3 h-3" />
                              {subscriber.customer.phone}
                            </p>
                            {subscriber.customer.email && (
                              <p className={`text-sm text-gray-500 flex items-center ${i18n.language === 'ar' ? 'flex-row-reverse justify-end' : 'flex-row'} gap-1`}>
                                <Mail className="w-3 h-3" />
                                {subscriber.customer.email}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-4 whitespace-nowrap ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          <p className="text-sm text-gray-900">
                            {i18n.language === 'ar' ? subscriber.package.name_ar || subscriber.package.name : subscriber.package.name}
                          </p>
                        </td>
                        <td className={`px-4 py-4 ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          <div className="space-y-1">
                            {subscriber.usage.map((usage, idx) => (
                              <div key={idx} className="text-sm">
                                <span className="text-gray-900">
                                  {i18n.language === 'ar' ? usage.service_name_ar || usage.service_name : usage.service_name}:
                                </span>
                                <span className={`${i18n.language === 'ar' ? 'mr-2' : 'ml-2'} font-medium ${
                                  usage.remaining_quantity > 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {usage.remaining_quantity} / {usage.original_quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className={`px-4 py-4 whitespace-nowrap ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          <div className="space-y-1">
                            {subscriber.usage.map((usage, idx) => (
                              <div key={idx} className="text-sm text-gray-600">
                                {usage.used_quantity} / {usage.original_quantity}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className={`px-4 py-4 whitespace-nowrap text-sm text-gray-500 ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          {format(new Date(subscriber.subscribed_at), 'MMM dd, yyyy', { locale: i18n.language === 'ar' ? ar : undefined })}
                        </td>
                        <td className={`px-4 py-4 whitespace-nowrap ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          {(() => {
                            const displayValue = getPaymentDisplayValue({ payment_status: subscriber.payment_status, payment_method: subscriber.payment_method });
                            const style = displayValue === 'unpaid' ? 'bg-amber-100 text-amber-800' : displayValue === 'paid_onsite' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
                            return (
                              <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${style}`}>
                                {t(PAYMENT_DISPLAY_KEYS[displayValue])}
                              </span>
                            );
                          })()}
                        </td>
                        <td className={`px-4 py-4 whitespace-nowrap ${i18n.language === 'ar' ? 'text-right' : 'text-left'}`}>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => openEditPaymentModal(subscriber)}
                              disabled={savingPaymentEdit}
                            >
                              <Edit2 className="w-4 h-4 mr-1" />
                              {i18n.language === 'ar' ? 'تعديل الدفع' : 'Edit payment'}
                            </Button>
                            {subscriber.zoho_invoice_id && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => downloadSubscriptionInvoice(subscriber.id)}
                                disabled={downloadingInvoiceId === subscriber.id}
                              >
                                {downloadingInvoiceId === subscriber.id ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-1" />
                                ) : (
                                  <Download className="w-4 h-4 mr-1" />
                                )}
                                {i18n.language === 'ar' ? 'تنزيل الفاتورة' : 'Download invoice'}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => handleCancelSubscription(subscriber.id)}
                              disabled={cancellingId === subscriber.id}
                            >
                              {cancellingId === subscriber.id ? (
                                i18n.language === 'ar' ? 'جاري الإلغاء...' : 'Cancelling...'
                              ) : (
                                <>
                                  <XCircle className="w-4 h-4 mr-1" />
                                  {i18n.language === 'ar' ? 'إلغاء' : 'Cancel'}
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {subscriberTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-600">
                    {i18n.language === 'ar' 
                      ? `الصفحة ${subscriberPage} من ${subscriberTotalPages}`
                      : `Page ${subscriberPage} of ${subscriberTotalPages}`
                    }
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSubscriberPage(p => Math.max(1, p - 1))}
                      disabled={subscriberPage === 1}
                    >
                      {i18n.language === 'ar' ? 'السابق' : 'Previous'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSubscriberPage(p => Math.min(subscriberTotalPages, p + 1))}
                      disabled={subscriberPage === subscriberTotalPages}
                    >
                      {i18n.language === 'ar' ? 'التالي' : 'Next'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
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
              {editingPaymentSubscription.customer.name} — {i18n.language?.startsWith('ar') ? editingPaymentSubscription.package.name_ar || editingPaymentSubscription.package.name : editingPaymentSubscription.package.name}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('booking.paymentStatus')}</label>
              <div className="flex flex-col gap-2">
                {(['unpaid', 'paid_onsite', 'bank_transfer'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editPaymentDisplayReception"
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

      {/* Subscribe Customer Modal — shared component (exact same UI + logic as admin) */}
      <ReceptionSubscribeModal
        isOpen={isSubscribeModalOpen}
        onClose={() => {
          setIsSubscribeModalOpen(false);
          setSelectedPackageForSubscribe(null);
        }}
        onSuccess={(data) => {
          setSubscriptionConfirmationData(data);
          if (activeTab === 'subscribers') fetchSubscribers();
        }}
        initialPackageId={selectedPackageForSubscribe}
      />

      {/* Subscription success confirmation — same style as booking confirmation */}
      <SubscriptionConfirmationModal
        isOpen={!!subscriptionConfirmationData}
        onClose={() => setSubscriptionConfirmationData(null)}
        data={subscriptionConfirmationData}
        onAddAnother={() => {
          setSubscriptionConfirmationData(null);
          setSelectedPackageForSubscribe(null);
          setIsSubscribeModalOpen(true);
        }}
        onViewSubscribers={() => {
          setSubscriptionConfirmationData(null);
          setActiveTab('subscribers');
          fetchSubscribers();
        }}
      />
    </div>
  );
}
