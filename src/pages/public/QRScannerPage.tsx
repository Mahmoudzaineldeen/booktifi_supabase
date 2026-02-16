import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../../contexts/CurrencyContext';
import { QRScanner } from '../../components/qr/QRScanner';
import { Card, CardContent } from '../../components/ui/Card';
import { format, parseISO } from 'date-fns';
import { User, Calendar, Clock, Package, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { getApiUrl } from '../../lib/apiUrl';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import { extractBookingIdFromQR, parseQRContentForDisplay } from '../../lib/qrUtils';
import { db } from '../../lib/db';
import { TicketsUnavailablePage } from '../../components/shared/TicketsUnavailablePage';

interface BookingDetails {
  id: string;
  customer_name: string;
  customer_phone: string;
  visitor_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  service_name: string;
  service_name_ar?: string;
  qr_scanned: boolean;
  qr_scanned_at?: string;
}

export function QRScannerPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(true);
  const [ticketsEnabled, setTicketsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tenantSlug) {
      setTicketsEnabled(true);
      return;
    }
    let cancelled = false;
    db
      .from('tenants')
      .select('tickets_enabled')
      .eq('slug', tenantSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setTicketsEnabled(data?.tickets_enabled !== false);
      })
      .catch(() => {
        if (!cancelled) setTicketsEnabled(true);
      });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const fetchBookingDetails = async (bookingId: string) => {
    setLoading(true);
    setError(null);
    setBookingDetails(null);

    try {
      // Validate booking ID format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(bookingId)) {
        throw new Error('Invalid QR code format. Please scan a valid booking ticket.');
      }

      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/bookings/${bookingId}/details`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch booking details' }));
        throw new Error(errorData.error || 'Booking not found');
      }

      const data = await response.json();
      setBookingDetails(data.booking);
      setIsScannerOpen(false);
    } catch (err: any) {
      console.error('Error fetching booking details:', err);
      setError(err.message || 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    // Extract booking ID from QR content (supports URL or raw UUID)
    const bookingId = extractBookingIdFromQR(decodedText.trim());
    if (bookingId) {
      fetchBookingDetails(bookingId);
    } else {
      setError('Invalid QR code format. QR code must contain a valid booking ID or URL.');
    }
  };

  const handleScanError = (errorMessage: string) => {
    setError(errorMessage);
  };

  if (ticketsEnabled === false) {
    return <TicketsUnavailablePage />;
  }

  if (ticketsEnabled === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (isScannerOpen) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardContent className="p-6">
                <h1 className="text-2xl font-bold mb-4">Scan Booking QR Code</h1>
                <p className="text-gray-600 mb-6">
                  Scan the QR code from your booking ticket to view booking details.
                </p>
                <QRScanner
                  title="Scan Booking QR Code"
                  onScanSuccess={handleScanSuccess}
                  onScanError={handleScanError}
                  onClose={() => {
                    if (tenantSlug) {
                      navigate(`/${tenantSlug}/book`);
                    } else {
                      navigate('/');
                    }
                  }}
                  showManualInput={true}
                  onManualInput={(value) => {
                    fetchBookingDetails(value);
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {error && (
            <Card className="mb-6">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-red-800 mb-1">Error</h3>
                    <p className="text-red-700">{error}</p>
                    <button
                      onClick={() => {
                        setError(null);
                        setIsScannerOpen(true);
                      }}
                      className="mt-4 text-sm text-red-600 hover:text-red-800 underline"
                    >
                      Try scanning again
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {loading && (
            <Card>
              <CardContent className="p-6 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading booking details...</p>
              </CardContent>
            </Card>
          )}

          {bookingDetails && !loading && (
            <>
              <Card className="mb-6">
                <CardContent className="p-6">
                  <div className="mb-6">
                    <h1 className="text-2xl font-bold">Ticket Details</h1>
                    <p className="text-sm text-gray-500 mt-1">Booking Reference: {bookingDetails.id.substring(0, 8)}...</p>
                  </div>

                  <div className="space-y-4">
                    {/* Customer Info */}
                    <div className="flex items-start gap-3">
                      <User className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Customer</p>
                        <p className="font-medium">{bookingDetails.customer_name}</p>
                        <p className="text-sm text-gray-600">{bookingDetails.customer_phone}</p>
                      </div>
                    </div>

                    {/* Service Info */}
                    <div className="flex items-start gap-3">
                      <Package className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Service</p>
                        <p className="font-medium">{bookingDetails.service_name}</p>
                      </div>
                    </div>

                    {/* Date & Time */}
                    <div className="flex items-start gap-3">
                      <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Date</p>
                        <p className="font-medium">
                          {format(parseISO(bookingDetails.slot_date), 'EEEE, MMMM dd, yyyy')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Clock className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Time</p>
                        <p className="font-medium">
                          {formatTimeTo12Hour(bookingDetails.start_time)} - {formatTimeTo12Hour(bookingDetails.end_time)}
                        </p>
                      </div>
                    </div>

                    {/* Visitor Count / Quantity */}
                    <div className="flex items-start gap-3">
                      <User className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Quantity</p>
                        <p className="font-medium">
                          {bookingDetails.visitor_count} {bookingDetails.visitor_count === 1 ? 'ticket' : 'tickets'}
                        </p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 text-gray-400 mt-0.5 flex items-center justify-center">$</div>
                      <div>
                        <p className="text-sm text-gray-500">Price</p>
                        <p className="font-medium">
                          {formatPrice(bookingDetails.total_price)}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Note: Status and payment information are NOT displayed in external scanner view */}
                  <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700">
                      This is a read-only ticket view. For payment status and booking updates, please contact the service provider.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setBookingDetails(null);
                    setError(null);
                    setIsScannerOpen(true);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Scan Another QR Code
                </button>
                {tenantSlug && (
                  <button
                    onClick={() => navigate(`/${tenantSlug}/book`)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Back to Booking
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
