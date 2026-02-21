import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { safeTranslateStatus } from '../../lib/safeTranslation';
import { getPaymentDisplayLabel, getPaymentDisplayValue } from '../../lib/paymentDisplay';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { QrCode, Scan, LogOut, User, Phone, Mail, Clock, CheckCircle, XCircle, DollarSign, Calendar, FileText, Wrench } from 'lucide-react';
import { QRScanner } from '../../components/qr/QRScanner';
import { format, parseISO } from 'date-fns';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getApiUrl } from '../../lib/apiUrl';
import { extractBookingIdFromQR } from '../../lib/qrUtils';
import { showNotification } from '../../contexts/NotificationContext';
import { AssignFixingTicketForm } from '../../components/support/AssignFixingTicketForm';

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  created_at: string;
  qr_scanned: boolean;
  qr_scanned_at: string | null;
  services: {
    name: string;
    name_ar: string;
  };
  slots: {
    slot_date: string;
    start_time: string;
    end_time: string;
  };
}

export function CashierPage() {
  const { t, i18n } = useTranslation();
  const { userProfile, tenant, signOut, loading: authLoading } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const tenantSlugForNav = tenantSlug || tenant?.slug || '';
  const isAssignFixingTicketPath = location.pathname.includes('/cashier/assign-fixing-ticket');
  const [scannedBooking, setScannedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [qrInputValue, setQrInputValue] = useState('');
  const [qrValidationResult, setQrValidationResult] = useState<{success: boolean; message: string; booking?: any} | null>(null);
  const [qrValidating, setQrValidating] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [markPaidMethod, setMarkPaidMethod] = useState<'onsite' | 'transfer'>('onsite');
  const [markPaidReference, setMarkPaidReference] = useState('');

  // Track if initial auth check has been completed
  const [initialAuthDone, setInitialAuthDone] = useState(false);
  const initialLoadRef = useRef(false);

  // Initial auth check - only runs once after auth is loaded
  useEffect(() => {
    if (initialLoadRef.current || initialAuthDone) {
      return;
    }

    if (authLoading) {
      return;
    }

    if (!userProfile) {
      navigate('/login');
      return;
    }

    // STRICT: Only cashiers allowed
    if (userProfile.role !== 'cashier') {
      console.log('CashierPage: Wrong role, redirecting. Expected: cashier, Got:', userProfile.role);
      navigate('/');
      return;
    }

    initialLoadRef.current = true;
    setInitialAuthDone(true);
    setLoading(false);
  }, [authLoading, userProfile, navigate, initialAuthDone]);

  // Monitor for logout
  useEffect(() => {
    if (!initialAuthDone || authLoading) return;

    if (!userProfile) {
      const timeoutId = setTimeout(() => {
        navigate('/login');
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userProfile, authLoading, navigate, initialAuthDone]);

  // Validate QR Code
  async function validateQRCode(qrContent: string) {
    setQrValidating(true);
    setQrValidationResult(null);

    try {
      // Extract booking ID from QR content (supports JSON, URL, or UUID)
      const bookingId = extractBookingIdFromQR(qrContent);
      
      if (!bookingId) {
        setQrValidationResult({
          success: false,
          message: i18n.language === 'ar' 
            ? 'تنسيق QR غير صالح. يجب أن يحتوي رمز QR على معرف حجز صالح.'
            : 'Invalid QR code format. QR code must contain a valid booking ID.',
        });
        setQrValidating(false);
        return;
      }

      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/validate-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ booking_id: bookingId }),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        setQrValidationResult({
          success: false,
          message: t('cashier.invalidServerResponse'),
        });
        setQrValidating(false);
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        setQrValidationResult({
          success: false,
          message: data.error || data.message || (i18n.language === 'ar' ? 'فشل التحقق من QR' : 'QR validation failed'),
        });
        setQrValidating(false);
        return;
      }

      if (data.success && data.booking) {
        const extractedId = data.extracted_booking_id || data.booking.id;
        setQrValidationResult({
          success: true,
          message: t('cashier.qrValidatedSuccessfully'),
          booking: data.booking,
        });
        
        // Fetch full booking details using extracted ID
        await fetchBookingDetails(extractedId);
      } else {
        setQrValidationResult({
          success: false,
          message: data.error || data.message || (i18n.language === 'ar' ? 'فشل التحقق من QR' : 'QR validation failed'),
        });
      }
    } catch (err: any) {
      console.error('Error validating QR code:', err);
      setQrValidationResult({
        success: false,
        message: err.message || t('cashier.failedToValidateQR'),
      });
    } finally {
      setQrValidating(false);
    }
  }

  // Fetch booking details after QR validation
  async function fetchBookingDetails(bookingId: string) {
    try {
      const { data, error } = await db
        .from('bookings')
        .select(`
          id,
          customer_name,
          customer_phone,
          customer_email,
          visitor_count,
          total_price,
          status,
          payment_status,
          payment_method,
          created_at,
          qr_scanned,
          qr_scanned_at,
          services (name, name_ar),
          slots (slot_date, start_time, end_time)
        `)
        .eq('id', bookingId)
        .single();

      if (error) throw error;
      if (data) {
        setScannedBooking(data as Booking);
      }
    } catch (err: any) {
      console.error('Error fetching booking details:', err);
    }
  }

  // Handle QR input (can be scanned or manually entered - supports JSON, URL, or UUID)
  function handleQRSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    
    const qrContent = qrInputValue.trim();
    if (!qrContent) {
      setQrValidationResult({
        success: false,
        message: t('cashier.pleaseEnterQRCodeOrBookingId'),
      });
      return;
    }

    validateQRCode(qrContent);
  }

  // Update payment status (Cashier can only mark as paid if unpaid)
  async function updatePaymentStatus(bookingId: string) {
    if (!userProfile?.tenant_id) return;
    if (markPaidMethod === 'transfer' && !markPaidReference.trim()) {
      showNotification('warning', t('reception.transactionReferenceRequired'));
      return;
    }

    setUpdatingPayment(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      const response = await fetch(`${API_URL}/bookings/${bookingId}/mark-paid`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          payment_method: markPaidMethod,
          transaction_reference: markPaidMethod === 'transfer' ? markPaidReference.trim() : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('cashier.failedToMarkAsPaid'));
      }

      if (scannedBooking) {
        await fetchBookingDetails(bookingId);
      }
      setMarkPaidReference('');

      showNotification('success', t('cashier.paymentStatusUpdatedSuccessfully'));
    } catch (err: any) {
      console.error('Error updating payment status:', err);
      showNotification('error', err.message || t('common.error'));
    } finally {
      setUpdatingPayment(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                {t('cashier.title', 'Cashier Desk')}
              </h1>
              <p className="text-xs md:text-sm text-gray-600">
                {t('cashier.welcomeCashier', 'Welcome, cashier')} {i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={isAssignFixingTicketPath ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => tenantSlugForNav && navigate(`/${tenantSlugForNav}/cashier/assign-fixing-ticket`)}
              >
                <Wrench className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">{t('navigation.assignFixingTicket', 'Assign Fixing Ticket')}</span>
              </Button>
              <LanguageToggle />
              <Button
                variant="secondary"
                size="sm"
                icon={<LogOut className="w-4 h-4" />}
                onClick={() => signOut()}
              >
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {tenant?.tickets_enabled === false && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center text-sm text-amber-800">
          {t('reception.ticketsDisabledBySettings')}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Assign Fixing Ticket view - same cashier header, no admin sidebar */}
        {isAssignFixingTicketPath ? (
          <AssignFixingTicketForm />
        ) : tenant?.tickets_enabled !== false ? (
          <Card className="mb-6">
            <CardContent className="py-6">
              <div className="text-center mb-6">
                <QrCode className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {t('cashier.scanQRCode')}
                </h2>
                <p className="text-gray-600">
                  {i18n.language === 'ar' 
                    ? 'امسح رمز QR للحجز لعرض التفاصيل وتحديث حالة الدفع'
                    : 'Scan the booking QR code to view details and update payment status'}
                </p>
              </div>

              <div className="flex justify-center mb-4">
                <Button
                  onClick={() => {
                    setIsQRScannerOpen(true);
                    setQrInputValue('');
                    setQrValidationResult(null);
                    setScannedBooking(null);
                  }}
                  icon={<Scan className="w-4 h-4" />}
                  size="lg"
                  variant="primary"
                >
                  {t('cashier.openQRScanner')}
                </Button>
              </div>

              {/* Manual Entry */}
              <div className="max-w-md mx-auto">
                <form onSubmit={handleQRSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={qrInputValue}
                    onChange={(e) => setQrInputValue(e.target.value)}
                    placeholder={t('cashier.enterBookingIdManually')}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    type="submit"
                    disabled={qrValidating || !qrInputValue.trim()}
                    variant="secondary"
                  >
                    {qrValidating 
                      ? (i18n.language === 'ar' ? 'جاري التحقق...' : 'Validating...')
                      : t('cashier.validate')}
                  </Button>
                </form>
              </div>

              {/* QR Validation Result */}
              {qrValidationResult && (
                <div className={`mt-4 p-4 rounded-lg ${
                  qrValidationResult.success 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-red-50 border border-red-200'
                }`}>
                  <p className={`text-sm ${
                    qrValidationResult.success ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {qrValidationResult.message}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardContent className="py-6">
              <div className="text-center">
                <QrCode className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-gray-700 mb-2">
                  {i18n.language === 'ar' ? 'مسح QR معطل' : 'QR scanning disabled'}
                </h2>
                <p className="text-gray-600 text-sm">
                  {i18n.language === 'ar' 
                    ? 'التذاكر معطلة في الإعدادات. لتفعيل مسح QR، قم بتشغيل التذاكر من الإعدادات → العمليات.'
                    : 'Tickets are disabled in settings. To enable QR scanning, turn on tickets in Settings → Operations.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scanned Booking Details - only on main cashier view */}
        {!isAssignFixingTicketPath && scannedBooking && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  {t('cashier.bookingDetails')}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setScannedBooking(null);
                    setQrValidationResult(null);
                    setQrInputValue('');
                  }}
                >
                  {t('cashier.close')}
                </Button>
              </div>

              <div className="space-y-4">
                {/* Customer Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{t('cashier.name')}</p>
                      <p className="font-medium">{scannedBooking.customer_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{t('cashier.phone')}</p>
                      <p className="font-medium">{scannedBooking.customer_phone}</p>
                    </div>
                  </div>
                  {scannedBooking.customer_email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">{t('cashier.email')}</p>
                        <p className="font-medium">{scannedBooking.customer_email}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{i18n.language === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}</p>
                      <p className="font-medium">
                        {format(parseISO(scannedBooking.slots.slot_date), 'MMM dd, yyyy')} • {formatTimeTo12Hour(scannedBooking.slots.start_time)} - {formatTimeTo12Hour(scannedBooking.slots.end_time)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Service Information */}
                <div className="border-t pt-4">
                  <p className="text-xs text-gray-500 mb-2">{t('cashier.service')}</p>
                  <p className="font-medium">
                    {i18n.language === 'ar' ? scannedBooking.services.name_ar : scannedBooking.services.name}
                  </p>
                </div>

                {/* Booking Status */}
                <div className="flex gap-2 flex-wrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    scannedBooking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                    scannedBooking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    scannedBooking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                    scannedBooking.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {safeTranslateStatus(t, scannedBooking.status, 'booking')}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    getPaymentDisplayValue(scannedBooking) === 'unpaid' ? 'bg-orange-100 text-orange-800' :
                    getPaymentDisplayValue(scannedBooking) === 'bank_transfer' ? 'bg-blue-100 text-blue-800' :
                    'bg-emerald-100 text-emerald-800'
                  }`}>
                    {getPaymentDisplayLabel(scannedBooking, t)}
                  </span>
                  {scannedBooking.qr_scanned && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {t('cashier.qrScanned')}
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="border-t pt-4">
                  <p className="text-xs text-gray-500 mb-1">{t('cashier.totalPrice')}</p>
                  <p className="text-2xl font-bold text-gray-900">{formatPrice(scannedBooking.total_price)}</p>
                </div>

                {/* Payment Action - Cashier: payment method + mark as paid */}
                {getPaymentDisplayValue(scannedBooking) === 'unpaid' && Number(scannedBooking.total_price) > 0 && (
                  <div className="border-t pt-4 space-y-3">
                    <p className="text-sm font-medium text-gray-700">
                      {i18n.language === 'ar' ? 'طريقة الدفع' : 'Payment method'}
                    </p>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="payment-method"
                          checked={markPaidMethod === 'onsite'}
                          onChange={() => setMarkPaidMethod('onsite')}
                          className="rounded-full border-gray-300 text-blue-600"
                        />
                        <span>مدفوع يدوياً</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="payment-method"
                          checked={markPaidMethod === 'transfer'}
                          onChange={() => setMarkPaidMethod('transfer')}
                          className="rounded-full border-gray-300 text-blue-600"
                        />
                        <span>حوالة</span>
                      </label>
                    </div>
                    {markPaidMethod === 'transfer' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {i18n.language === 'ar' ? 'رقم المرجع (مطلوب)' : 'Transaction Reference Number (required)'}
                        </label>
                        <input
                          type="text"
                          value={markPaidReference}
                          onChange={(e) => setMarkPaidReference(e.target.value)}
                          placeholder={i18n.language === 'ar' ? 'أدخل رقم المرجع' : 'Enter reference number'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                    <Button
                      onClick={() => updatePaymentStatus(scannedBooking.id)}
                      disabled={updatingPayment || (markPaidMethod === 'transfer' && !markPaidReference.trim())}
                      icon={<DollarSign className="w-4 h-4" />}
                      variant="primary"
                      className="w-full"
                    >
                      {updatingPayment 
                        ? (i18n.language === 'ar' ? 'جاري التحديث...' : 'Updating...')
                        : t('cashier.markAsPaid')}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State - only on main cashier view */}
        {!isAssignFixingTicketPath && !scannedBooking && !qrValidationResult && (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {t('cashier.noBookingDetails')}
              </h3>
              <p className="text-gray-600">
                {t('cashier.scanQRCodeOrEnterBookingId')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* QR Scanner Modal - only when tickets are enabled */}
      {isQRScannerOpen && tenant?.tickets_enabled !== false && (
        <Modal
          isOpen={isQRScannerOpen}
          onClose={() => {
            setIsQRScannerOpen(false);
            setQrInputValue('');
          }}
          title={t('cashier.scanQRCode')}
        >
          <QRScanner
            onScanSuccess={(result) => {
              setQrInputValue(result);
              setIsQRScannerOpen(false);
              validateQRCode(result);
            }}
            onManualInput={(input) => {
              setQrInputValue(input);
              setIsQRScannerOpen(false);
              if (input) {
                validateQRCode(input);
              }
            }}
            onClose={() => {
              setIsQRScannerOpen(false);
              setQrInputValue('');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
