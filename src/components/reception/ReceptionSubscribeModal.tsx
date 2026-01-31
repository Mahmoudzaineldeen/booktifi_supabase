/**
 * Shared Reception Subscribe Customer Modal.
 * "Add Subscription" form: Customer Phone (country + number), Customer Name, Customer Email, Select Package.
 * Used by: ReceptionPackagesPage (reception) and PackageSubscribersPage (admin).
 * API: GET /packages/receptionist/packages, POST /packages/receptionist/subscriptions (accepts phone/name/email or customer_id).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useTenantDefaultCountry } from '../../hooks/useTenantDefaultCountry';
import { getApiUrl } from '../../lib/apiUrl';
import { db } from '../../lib/db';
import { Button } from '../ui/Button';
import { PhoneInput } from '../ui/PhoneInput';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { CheckCircle } from 'lucide-react';
import type { SubscriptionConfirmationData } from '../shared/SubscriptionConfirmationModal';

interface PackageItem {
  id: string;
  name: string;
  name_ar?: string;
  total_price: number;
}

export interface ReceptionSubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with subscription data on success so parent can show confirmation modal */
  onSuccess?: (data: SubscriptionConfirmationData) => void;
  /** When opening from a package row, pre-select this package id */
  initialPackageId?: string | null;
}

export function ReceptionSubscribeModal({
  isOpen,
  onClose,
  onSuccess,
  initialPackageId = null,
}: ReceptionSubscribeModalProps) {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { formatPrice } = useCurrency();
  const defaultCountryCode = useTenantDefaultCountry();

  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [customerPhoneFull, setCustomerPhoneFull] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerLookup, setCustomerLookup] = useState<{ id: string; name: string; email?: string; phone: string } | null>(null);
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'unpaid' | 'onsite' | 'transfer'>('onsite');
  const [transactionReference, setTransactionReference] = useState('');
  const lookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-select package when opening with initialPackageId
  useEffect(() => {
    if (isOpen && initialPackageId) {
      setSelectedPackageId(initialPackageId);
    }
  }, [isOpen, initialPackageId]);

  // Fetch packages when modal opens. Same route for reception and tenant dashboard; backend uses authenticateSubscriptionManager (allows tenant_admin, customer_admin).
  useEffect(() => {
    if (!isOpen || !userProfile?.tenant_id) return;
    let cancelled = false;
    setPackagesLoading(true);
    const token = localStorage.getItem('auth_token');
    fetch(`${getApiUrl()}/packages/receptionist/packages`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json',
      },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => {
        if (!cancelled) setPackages(data.packages || []);
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
      })
      .finally(() => {
        if (!cancelled) setPackagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, userProfile?.tenant_id]);

  // Look up customer by phone and autofill name/email (same as receptionist Add Subscription)
  const lookupCustomerByPhone = useCallback(
    async (fullPhoneNumber: string) => {
      if (!fullPhoneNumber || fullPhoneNumber.length < 10 || !userProfile?.tenant_id) {
        setCustomerLookup(null);
        setIsLookingUpCustomer(false);
        return;
      }
      setIsLookingUpCustomer(true);
      setCustomerLookup(null);
      try {
        const { data, error } = await db
          .from('customers')
          .select('id, name, email, phone')
          .eq('tenant_id', userProfile.tenant_id)
          .eq('phone', fullPhoneNumber)
          .maybeSingle();

        if (error) {
          console.error('Error looking up customer:', error);
          setCustomerLookup(null);
          setCustomerName('');
          setCustomerEmail('');
          return;
        }
        if (data) {
          setCustomerLookup(data);
          setCustomerName(data.name || '');
          setCustomerEmail(data.email || '');
        } else {
          setCustomerLookup(null);
          setCustomerName('');
          setCustomerEmail('');
        }
      } catch (err) {
        console.error('Lookup customer error:', err);
        setCustomerLookup(null);
      } finally {
        setIsLookingUpCustomer(false);
      }
    },
    [userProfile?.tenant_id]
  );

  function handlePhoneChange(value: string) {
    setCustomerPhoneFull(value);
    if (customerLookup) setCustomerLookup(null);
    if (lookupTimeoutRef.current) {
      clearTimeout(lookupTimeoutRef.current);
      lookupTimeoutRef.current = null;
    }
    if (value.length >= 10) {
      lookupTimeoutRef.current = setTimeout(() => lookupCustomerByPhone(value), 350);
    } else {
      setCustomerName('');
      setCustomerEmail('');
    }
  }

  useEffect(() => () => {
    if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current);
  }, []);

  function handleClose() {
    setSelectedPackageId(initialPackageId || null);
    setCustomerPhoneFull('');
    setCustomerName('');
    setCustomerEmail('');
    setCustomerLookup(null);
    setPaymentMethod('onsite' as const);
    setTransactionReference('');
    onClose();
  }

  async function handleSubscribe() {
    if (!customerPhoneFull.trim() || !customerName.trim() || !selectedPackageId) {
      alert(
        i18n.language === 'ar'
          ? 'يرجى إدخال رقم الهاتف واسم العميل واختيار الباقة.'
          : 'Please enter customer phone, name, and select a package.'
      );
      return;
    }
    if (paymentMethod === 'transfer' && !transactionReference.trim()) {
      alert(t('reception.transactionReferenceRequired') || 'Transaction reference number is required for transfer payment.');
      return;
    }
    try {
      setSubscribing(true);
      const token = localStorage.getItem('auth_token');
      const body: Record<string, string | undefined> = {
        package_id: selectedPackageId,
        customer_phone: customerPhoneFull.trim(),
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || undefined,
      };
      if (paymentMethod === 'unpaid') {
        body.payment_status = 'pending';
      } else {
        body.payment_status = 'paid';
        body.payment_method = paymentMethod;
        if (paymentMethod === 'transfer' && transactionReference.trim()) body.transaction_reference = transactionReference.trim();
      }
      const response = await fetch(`${getApiUrl()}/packages/receptionist/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to subscribe customer');
      }
      const pkg = packages.find((p) => p.id === selectedPackageId);
      const confirmationData: SubscriptionConfirmationData = {
        subscriptionId: data.subscription?.id ?? '',
        customerName: customerName,
        customerPhone: customerPhoneFull.trim() || undefined,
        packageName: data.subscription?.package?.name ?? pkg?.name ?? '',
        packageNameAr: data.subscription?.package?.name_ar ?? pkg?.name_ar,
        subscribedAt: data.subscription?.subscribed_at ?? new Date().toISOString(),
        totalPrice: pkg?.total_price ?? data.subscription?.package?.total_price,
        invoiceCreated: !!data.invoice?.id,
        invoiceError: data.invoice_error,
      };
      handleClose();
      onSuccess?.(confirmationData);
    } catch (error: any) {
      console.error('Error subscribing customer:', error);
      alert(
        i18n.language === 'ar' ? `خطأ في الاشتراك: ${error.message}` : `Error subscribing customer: ${error.message}`
      );
    } finally {
      setSubscribing(false);
    }
  }

  const canSubmit = customerPhoneFull.trim() && customerName.trim() && selectedPackageId && !subscribing;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={i18n.language === 'ar' ? 'إضافة اشتراك' : 'Add Subscription'}
    >
      <div className="space-y-4">
        {/* Customer Phone with auto-fill (same as receptionist Add Subscription) */}
        <div className="relative">
          <PhoneInput
            label={i18n.language === 'ar' ? 'هاتف العميل' : 'Customer Phone'}
            value={customerPhoneFull}
            onChange={handlePhoneChange}
            defaultCountry={defaultCountryCode}
            required
            language={i18n.language === 'ar' ? 'ar' : 'en'}
          />
          {isLookingUpCustomer && (
            <div className="absolute right-3 top-[38px]">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
            </div>
          )}
        </div>
        {customerLookup && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700 flex items-center gap-1">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>
                {i18n.language === 'ar' ? 'عميل موجود' : 'Existing customer'}: <strong>{customerLookup.name}</strong>
                {customerLookup.email && ` (${customerLookup.email})`}
              </span>
            </p>
          </div>
        )}
        {customerPhoneFull.length >= 10 && !customerLookup && !isLookingUpCustomer && (
          <p className="text-sm text-blue-600">
            {i18n.language === 'ar' ? 'عميل جديد' : 'New customer'}
          </p>
        )}

        {/* Customer Name — required */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {i18n.language === 'ar' ? 'اسم العميل' : 'Customer Name'} <span className="text-red-600">**</span>
          </label>
          <Input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={i18n.language === 'ar' ? 'اسم العميل' : 'Customer Name'}
          />
        </div>

        {/* Customer Email — optional */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {i18n.language === 'ar' ? 'البريد الإلكتروني للعميل' : 'Customer Email'}
          </label>
          <Input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder={i18n.language === 'ar' ? 'البريد الإلكتروني للعميل' : 'Customer Email'}
          />
        </div>

        {/* Select Package — required */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {i18n.language === 'ar' ? 'اختر الباقة' : 'Select Package'} <span className="text-red-600">*</span>
          </label>
          <select
            value={selectedPackageId || ''}
            onChange={(e) => setSelectedPackageId(e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">{i18n.language === 'ar' ? '-- اختر الباقة --' : '-- Select Package --'}</option>
            {packagesLoading ? (
              <option value="" disabled>
                {i18n.language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
              </option>
            ) : (
              packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {i18n.language === 'ar' ? pkg.name_ar || pkg.name : pkg.name} - {formatPrice(pkg.total_price)}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Payment method (Unpaid | Paid On Site | Bank Transfer — same as bookings) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('reception.paymentMethod') || 'Payment method'}
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="subscriptionPaymentMethod"
                checked={paymentMethod === 'unpaid'}
                onChange={() => { setPaymentMethod('unpaid'); setTransactionReference(''); }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t('payment.displayUnpaid') || (i18n.language === 'ar' ? 'غير مدفوع' : 'Unpaid')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="subscriptionPaymentMethod"
                checked={paymentMethod === 'onsite'}
                onChange={() => { setPaymentMethod('onsite'); setTransactionReference(''); }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t('payment.displayPaidOnSite') || (i18n.language === 'ar' ? 'مدفوع يدوياً' : 'Paid On Site')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="subscriptionPaymentMethod"
                checked={paymentMethod === 'transfer'}
                onChange={() => setPaymentMethod('transfer')}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t('payment.displayBankTransfer') || (i18n.language === 'ar' ? 'حوالة بنكية' : 'Bank Transfer')}</span>
            </label>
          </div>
          {paymentMethod === 'transfer' && (
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('reception.transactionReference') || 'Transaction reference'} <span className="text-red-600">*</span>
              </label>
              <Input
                type="text"
                value={transactionReference}
                onChange={(e) => setTransactionReference(e.target.value)}
                placeholder={i18n.language === 'ar' ? 'رقم المرجع أو الحوالة' : 'Transfer reference number'}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Button fullWidth onClick={handleSubscribe} disabled={!canSubmit || subscribing}>
            {subscribing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                {i18n.language === 'ar' ? 'جاري الاشتراك...' : 'Subscribing...'}
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                {i18n.language === 'ar' ? 'اشترك' : 'Subscribe'}
              </>
            )}
          </Button>
          <Button variant="secondary" fullWidth onClick={handleClose} disabled={subscribing}>
            {i18n.language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
