import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { QrCode, Scan, LogOut, User, Phone, Mail, Clock, CheckCircle, XCircle, DollarSign, Calendar, FileText } from 'lucide-react';
import { QRScanner } from '../../components/qr/QRScanner';
import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../../lib/apiUrl';

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
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
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [scannedBooking, setScannedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [qrInputValue, setQrInputValue] = useState('');
  const [qrValidationResult, setQrValidationResult] = useState<{success: boolean; message: string; booking?: any} | null>(null);
  const [qrValidating, setQrValidating] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);

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
  async function validateQRCode(bookingId: string) {
    setQrValidating(true);
    setQrValidationResult(null);

    try {
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
          message: i18n.language === 'ar' ? 'خطأ في الاستجابة من الخادم' : 'Invalid server response',
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
          message: i18n.language === 'ar' ? 'تم التحقق بنجاح' : 'QR validated successfully',
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
        message: err.message || (i18n.language === 'ar' ? 'فشل التحقق من QR' : 'Failed to validate QR code'),
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

  // Handle QR input (can be scanned or manually entered)
  function handleQRSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    
    const bookingId = qrInputValue.trim();
    if (!bookingId) {
      setQrValidationResult({
        success: false,
        message: i18n.language === 'ar' ? 'يرجى إدخال رقم الحجز' : 'Please enter booking ID',
      });
      return;
    }

    validateQRCode(bookingId);
  }

  // Update payment status (Cashier can only mark as paid if unpaid)
  async function updatePaymentStatus(bookingId: string) {
    if (!userProfile?.tenant_id) return;

    setUpdatingPayment(true);
    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');

      // Use cashier-specific endpoint
      const response = await fetch(`${API_URL}/bookings/${bookingId}/mark-paid`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to mark booking as paid');
      }

      // Refresh booking details
      if (scannedBooking) {
        await fetchBookingDetails(bookingId);
      }

      alert(i18n.language === 'ar' 
        ? 'تم تحديث حالة الدفع بنجاح' 
        : 'Payment status updated successfully');
    } catch (err: any) {
      console.error('Error updating payment status:', err);
      alert(i18n.language === 'ar' 
        ? `خطأ: ${err.message}` 
        : `Error: ${err.message}`);
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
                {i18n.language === 'ar' ? 'مكتب الصراف' : 'Cashier Desk'}
              </h1>
              <p className="text-xs md:text-sm text-gray-600">
                {i18n.language === 'ar' ? 'مرحباً، الصراف' : 'Welcome, Cashier'} {i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* QR Scanner Section */}
        <Card className="mb-6">
          <CardContent className="py-6">
            <div className="text-center mb-6">
              <QrCode className="w-16 h-16 text-blue-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {i18n.language === 'ar' ? 'مسح رمز QR' : 'Scan QR Code'}
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
                {i18n.language === 'ar' ? 'فتح الماسح الضوئي' : 'Open QR Scanner'}
              </Button>
            </div>

            {/* Manual Entry */}
            <div className="max-w-md mx-auto">
              <form onSubmit={handleQRSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={qrInputValue}
                  onChange={(e) => setQrInputValue(e.target.value)}
                  placeholder={i18n.language === 'ar' ? 'أدخل رقم الحجز يدوياً' : 'Enter booking ID manually'}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  type="submit"
                  disabled={qrValidating || !qrInputValue.trim()}
                  variant="secondary"
                >
                  {qrValidating 
                    ? (i18n.language === 'ar' ? 'جاري التحقق...' : 'Validating...')
                    : (i18n.language === 'ar' ? 'تحقق' : 'Validate')}
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

        {/* Scanned Booking Details */}
        {scannedBooking && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  {i18n.language === 'ar' ? 'تفاصيل الحجز' : 'Booking Details'}
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
                  {i18n.language === 'ar' ? 'إغلاق' : 'Close'}
                </Button>
              </div>

              <div className="space-y-4">
                {/* Customer Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{i18n.language === 'ar' ? 'الاسم' : 'Name'}</p>
                      <p className="font-medium">{scannedBooking.customer_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{i18n.language === 'ar' ? 'الهاتف' : 'Phone'}</p>
                      <p className="font-medium">{scannedBooking.customer_phone}</p>
                    </div>
                  </div>
                  {scannedBooking.customer_email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">{i18n.language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</p>
                        <p className="font-medium">{scannedBooking.customer_email}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">{i18n.language === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}</p>
                      <p className="font-medium">
                        {format(parseISO(scannedBooking.slots.slot_date), 'MMM dd, yyyy')} • {scannedBooking.slots.start_time} - {scannedBooking.slots.end_time}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Service Information */}
                <div className="border-t pt-4">
                  <p className="text-xs text-gray-500 mb-2">{i18n.language === 'ar' ? 'الخدمة' : 'Service'}</p>
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
                    {scannedBooking.status.toUpperCase()}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    scannedBooking.payment_status === 'paid' || scannedBooking.payment_status === 'paid_manual' 
                      ? 'bg-emerald-100 text-emerald-800' :
                    scannedBooking.payment_status === 'unpaid' 
                      ? 'bg-orange-100 text-orange-800' :
                    scannedBooking.payment_status === 'awaiting_payment' 
                      ? 'bg-amber-100 text-amber-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {scannedBooking.payment_status.toUpperCase().replace('_', ' ')}
                  </span>
                  {scannedBooking.qr_scanned && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {i18n.language === 'ar' ? 'تم المسح' : 'QR Scanned'}
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="border-t pt-4">
                  <p className="text-xs text-gray-500 mb-1">{i18n.language === 'ar' ? 'السعر الإجمالي' : 'Total Price'}</p>
                  <p className="text-2xl font-bold text-gray-900">{scannedBooking.total_price} SAR</p>
                </div>

                {/* Payment Action - Cashier can only mark as paid if unpaid */}
                {(scannedBooking.payment_status === 'unpaid' || scannedBooking.payment_status === 'awaiting_payment') && (
                  <div className="border-t pt-4">
                    <Button
                      onClick={() => updatePaymentStatus(scannedBooking.id)}
                      disabled={updatingPayment}
                      icon={<DollarSign className="w-4 h-4" />}
                      variant="primary"
                      className="w-full"
                    >
                      {updatingPayment 
                        ? (i18n.language === 'ar' ? 'جاري التحديث...' : 'Updating...')
                        : (i18n.language === 'ar' ? 'تحديد كمدفوع' : 'Mark as Paid')}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!scannedBooking && !qrValidationResult && (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {i18n.language === 'ar' ? 'لا توجد تفاصيل حجز' : 'No Booking Details'}
              </h3>
              <p className="text-gray-600">
                {i18n.language === 'ar' 
                  ? 'امسح رمز QR أو أدخل رقم الحجز لعرض التفاصيل'
                  : 'Scan a QR code or enter a booking ID to view details'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* QR Scanner Modal */}
      {isQRScannerOpen && (
        <Modal
          isOpen={isQRScannerOpen}
          onClose={() => {
            setIsQRScannerOpen(false);
            setQrInputValue('');
          }}
          title={i18n.language === 'ar' ? 'مسح رمز QR' : 'Scan QR Code'}
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
