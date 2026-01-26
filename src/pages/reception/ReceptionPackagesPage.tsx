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

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { db } from '../../lib/db';
import { getApiUrl } from '../../lib/apiUrl';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Package, Users, Search, X, CheckCircle, AlertCircle, Phone, Mail } from 'lucide-react';
import { format } from 'date-fns';

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

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
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
  
  // Subscribe Customer Modal
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [selectedPackageForSubscribe, setSelectedPackageForSubscribe] = useState<string | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Search customers for subscribe modal
  async function searchCustomers(query: string) {
    if (!userProfile?.tenant_id || !query.trim()) {
      setCustomerSearchResults([]);
      return;
    }

    setIsSearchingCustomers(true);
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const { data, error } = await db
          .from('customers')
          .select('id, name, phone, email')
          .eq('tenant_id', userProfile.tenant_id)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
          .limit(10);

        if (error) {
          console.error('Error searching customers:', error);
          setCustomerSearchResults([]);
        } else {
          setCustomerSearchResults(data || []);
        }
      } catch (error) {
        console.error('Error searching customers:', error);
        setCustomerSearchResults([]);
      } finally {
        setIsSearchingCustomers(false);
      }
    }, 300);
  }

  async function handleSubscribeCustomer() {
    if (!selectedCustomer || !selectedPackageForSubscribe) {
      return;
    }

    try {
      setSubscribing(true);
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${getApiUrl()}/packages/receptionist/subscriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          package_id: selectedPackageForSubscribe,
          customer_id: selectedCustomer.id
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to subscribe customer');
      }

      const data = await response.json();
      
      // Show success message
      alert(i18n.language === 'ar' 
        ? `تم الاشتراك بنجاح: ${selectedCustomer.name} → ${data.subscription?.package?.name || ''}`
        : `Successfully subscribed: ${selectedCustomer.name} → ${data.subscription?.package?.name || ''}`
      );

      // Reset modal
      setIsSubscribeModalOpen(false);
      setSelectedPackageForSubscribe(null);
      setSelectedCustomer(null);
      setCustomerSearchQuery('');
      setCustomerSearchResults([]);

      // Refresh subscribers if on that tab
      if (activeTab === 'subscribers') {
        fetchSubscribers();
      }
    } catch (error: any) {
      console.error('Error subscribing customer:', error);
      alert(i18n.language === 'ar' 
        ? `خطأ في الاشتراك: ${error.message}`
        : `Error subscribing customer: ${error.message}`
      );
    } finally {
      setSubscribing(false);
    }
  }

  function openSubscribeModal(packageId?: string) {
    setSelectedPackageForSubscribe(packageId || null);
    setSelectedCustomer(null);
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setIsSubscribeModalOpen(true);
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
                        size="sm"
                        onClick={() => openSubscribeModal(pkg.id)}
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
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {i18n.language === 'ar' ? 'العميل' : 'Customer'}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {i18n.language === 'ar' ? 'الباقة' : 'Package'}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {i18n.language === 'ar' ? 'السعة المتبقية' : 'Remaining Capacity'}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {i18n.language === 'ar' ? 'المستهلك' : 'Consumed'}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {i18n.language === 'ar' ? 'تاريخ الاشتراك' : 'Subscription Date'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {subscribers.map((subscriber) => (
                      <tr key={subscriber.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{subscriber.customer.name}</p>
                            <p className="text-sm text-gray-500 flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {subscriber.customer.phone}
                            </p>
                            {subscriber.customer.email && (
                              <p className="text-sm text-gray-500 flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {subscriber.customer.email}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-900">
                            {i18n.language === 'ar' ? subscriber.package.name_ar || subscriber.package.name : subscriber.package.name}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-1">
                            {subscriber.usage.map((usage, idx) => (
                              <div key={idx} className="text-sm">
                                <span className="text-gray-900">
                                  {i18n.language === 'ar' ? usage.service_name_ar || usage.service_name : usage.service_name}:
                                </span>
                                <span className={`ml-2 font-medium ${
                                  usage.remaining_quantity > 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {usage.remaining_quantity} / {usage.original_quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="space-y-1">
                            {subscriber.usage.map((usage, idx) => (
                              <div key={idx} className="text-sm text-gray-600">
                                {usage.used_quantity} / {usage.original_quantity}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                          {format(new Date(subscriber.subscribed_at), 'MMM dd, yyyy')}
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

      {/* Subscribe Customer Modal */}
      <Modal
        isOpen={isSubscribeModalOpen}
        onClose={() => {
          setIsSubscribeModalOpen(false);
          setSelectedPackageForSubscribe(null);
          setSelectedCustomer(null);
          setCustomerSearchQuery('');
          setCustomerSearchResults([]);
        }}
        title={i18n.language === 'ar' ? 'اشترك عميل في باقة' : 'Subscribe Customer to Package'}
      >
        <div className="space-y-4">
          {/* Package Selection */}
          {!selectedPackageForSubscribe && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {i18n.language === 'ar' ? 'اختر الباقة' : 'Select Package'}
              </label>
              <select
                value={selectedPackageForSubscribe || ''}
                onChange={(e) => setSelectedPackageForSubscribe(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{i18n.language === 'ar' ? '-- اختر الباقة --' : '-- Select Package --'}</option>
                {packages.map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {i18n.language === 'ar' ? pkg.name_ar || pkg.name : pkg.name} - {formatPrice(pkg.total_price)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Customer Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {i18n.language === 'ar' ? 'ابحث عن العميل' : 'Search Customer'}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="text"
                value={customerSearchQuery}
                onChange={(e) => {
                  setCustomerSearchQuery(e.target.value);
                  searchCustomers(e.target.value);
                }}
                placeholder={i18n.language === 'ar' ? 'اسم العميل أو رقم الهاتف...' : 'Customer name or phone...'}
                className="pl-10"
              />
            </div>

            {/* Customer Search Results */}
            {customerSearchQuery && customerSearchResults.length > 0 && (
              <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {customerSearchResults.map(customer => (
                  <button
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setCustomerSearchQuery(customer.name);
                      setCustomerSearchResults([]);
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-50 border-b last:border-b-0 ${
                      selectedCustomer?.id === customer.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <p className="font-medium text-gray-900">{customer.name}</p>
                    <p className="text-sm text-gray-500">{customer.phone}</p>
                    {customer.email && (
                      <p className="text-sm text-gray-500">{customer.email}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {isSearchingCustomers && (
              <p className="mt-2 text-sm text-gray-500">{i18n.language === 'ar' ? 'جاري البحث...' : 'Searching...'}</p>
            )}

            {customerSearchQuery && !isSearchingCustomers && customerSearchResults.length === 0 && (
              <p className="mt-2 text-sm text-gray-500">
                {i18n.language === 'ar' ? 'لم يتم العثور على عملاء' : 'No customers found'}
              </p>
            )}
          </div>

          {/* Selected Customer Display */}
          {selectedCustomer && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-gray-900">
                {i18n.language === 'ar' ? 'العميل المحدد' : 'Selected Customer'}:
              </p>
              <p className="text-sm text-gray-700">{selectedCustomer.name}</p>
              <p className="text-sm text-gray-600">{selectedCustomer.phone}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              fullWidth
              onClick={handleSubscribeCustomer}
              disabled={!selectedCustomer || !selectedPackageForSubscribe || subscribing}
            >
              {subscribing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {i18n.language === 'ar' ? 'جاري الاشتراك...' : 'Subscribing...'}
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {i18n.language === 'ar' ? 'اشترك' : 'Subscribe'}
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setIsSubscribeModalOpen(false);
                setSelectedPackageForSubscribe(null);
                setSelectedCustomer(null);
                setCustomerSearchQuery('');
                setCustomerSearchResults([]);
              }}
            >
              {i18n.language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
