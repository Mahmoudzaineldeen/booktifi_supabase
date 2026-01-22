import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRScanner } from '../../components/qr/QRScanner';
import { Card, CardContent } from '../../components/ui/Card';
import { format, parseISO } from 'date-fns';
import { User, Calendar, Clock, Package, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { getApiUrl } from '../../lib/apiUrl';

interface BookingDetails {
  id: string;
  customer_name: string;
  customer_phone: string;
  visitor_count: number;
  adult_count: number;
  child_count: number;
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
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(true);

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
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold">Booking Details</h1>
                    <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                      bookingDetails.status === 'confirmed'
                        ? 'bg-green-100 text-green-800'
                        : bookingDetails.status === 'checked_in'
                        ? 'bg-blue-100 text-blue-800'
                        : bookingDetails.status === 'completed'
                        ? 'bg-gray-100 text-gray-800'
                        : bookingDetails.status === 'cancelled'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {bookingDetails.status.replace('_', ' ').toUpperCase()}
                    </div>
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
                          {bookingDetails.start_time} - {bookingDetails.end_time}
                        </p>
                      </div>
                    </div>

                    {/* Visitor Count */}
                    <div className="flex items-start gap-3">
                      <User className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm text-gray-500">Visitors</p>
                        <p className="font-medium">
                          {bookingDetails.visitor_count} {bookingDetails.visitor_count === 1 ? 'person' : 'people'}
                          {bookingDetails.adult_count > 0 && bookingDetails.child_count > 0 && (
                            <span className="text-sm text-gray-600 ml-2">
                              ({bookingDetails.adult_count} adult{bookingDetails.adult_count !== 1 ? 's' : ''}, {bookingDetails.child_count} child{bookingDetails.child_count !== 1 ? 'ren' : ''})
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Payment Status */}
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full mt-0.5 ${
                        bookingDetails.payment_status === 'paid' || bookingDetails.payment_status === 'paid_manual'
                          ? 'bg-green-500'
                          : bookingDetails.payment_status === 'awaiting_payment'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`} />
                      <div>
                        <p className="text-sm text-gray-500">Payment Status</p>
                        <p className="font-medium capitalize">
                          {bookingDetails.payment_status.replace('_', ' ')}
                        </p>
                      </div>
                    </div>

                    {/* QR Scan Status */}
                    {bookingDetails.qr_scanned && (
                      <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-green-800">QR Code Scanned</p>
                          {bookingDetails.qr_scanned_at && (
                            <p className="text-xs text-green-600">
                              Scanned on {format(parseISO(bookingDetails.qr_scanned_at), 'MMM dd, yyyy HH:mm')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
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
