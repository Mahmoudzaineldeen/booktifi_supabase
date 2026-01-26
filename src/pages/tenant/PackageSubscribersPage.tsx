import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Package, Users, Search, X, Calendar, Filter, FileSearch, Phone, Mail, CheckCircle, Briefcase, TrendingUp, TrendingDown, Hash, XCircle, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { getApiUrl } from '../../lib/apiUrl';

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
  const [subscribers, setSubscribers] = useState<PackageSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search state
  const [searchType, setSearchType] = useState<SearchType>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PackageSubscriber[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState<string>('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscribers();
  }, [userProfile]);

  async function fetchSubscribers() {
    if (!userProfile?.tenant_id) return;

    try {
      setLoading(true);
      
      // Fetch all active package subscriptions with related data
      const { data, error } = await db
        .from('package_subscriptions')
        .select(`
          id,
          customer_id,
          package_id,
          status,
          subscribed_at,
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
    if (!window.confirm(
      i18n.language === 'ar' 
        ? 'هل أنت متأكد من إلغاء هذه الاشتراك؟ لا يمكن التراجع عن هذا الإجراء.'
        : 'Are you sure you want to cancel this subscription? This action cannot be undone.'
    )) {
      return;
    }

    try {
      setCancellingId(subscriptionId);
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/api/packages/subscriptions/${subscriptionId}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || 'Failed to cancel subscription');
      }

      const result = await response.json();
      alert(
        i18n.language === 'ar' 
          ? 'تم إلغاء الاشتراك بنجاح'
          : 'Subscription cancelled successfully'
      );

      // Refresh the list
      await fetchSubscribers();
    } catch (error: any) {
      console.error('Error cancelling subscription:', error);
      alert(
        i18n.language === 'ar' 
          ? `خطأ في إلغاء الاشتراك: ${error.message}`
          : `Error cancelling subscription: ${error.message}`
      );
    } finally {
      setCancellingId(null);
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
                        locale: i18n.language === 'ar' ? require('date-fns/locale/ar') : undefined
                      })}
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <div className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        <CheckCircle className="w-3 h-3" />
                        {t('packages.subscribers.active', 'Active')}
                      </div>
                      <button
                        onClick={() => handleCancelSubscription(subscriber.id)}
                        disabled={cancellingId === subscriber.id}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title={i18n.language === 'ar' ? 'إلغاء الاشتراك' : 'Cancel Subscription'}
                      >
                        {cancellingId === subscriber.id ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-800"></div>
                            {i18n.language === 'ar' ? 'جاري الإلغاء...' : 'Cancelling...'}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            {i18n.language === 'ar' ? 'إلغاء' : 'Cancel'}
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
    </div>
  );
}
