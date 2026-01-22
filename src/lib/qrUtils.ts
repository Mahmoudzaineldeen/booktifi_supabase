/**
 * Extract booking ID from QR code content
 * Supports multiple formats:
 * 1. JSON format (new): {"booking_id":"uuid",...}
 * 2. URL format (legacy): https://domain.com/api/bookings/{uuid}/details
 * 3. Raw UUID format (legacy): 123e4567-e89b-12d3-a456-426614174000
 */
export function extractBookingIdFromQR(qrContent: string): string | null {
  if (!qrContent || typeof qrContent !== 'string') {
    return null;
  }

  const trimmed = qrContent.trim();
  
  // NEW: Try to parse as JSON (structured booking data format)
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.booking_id) {
      // Validate it's a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(parsed.booking_id)) {
        console.log('[QR Extract] Found booking_id in JSON format');
        return parsed.booking_id;
      }
    }
  } catch (e) {
    // Not JSON, continue to other formats
  }
  
  // LEGACY: If it's already a raw UUID, return it
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) {
    console.log('[QR Extract] Found raw UUID format');
    return trimmed;
  }

  // LEGACY: Try to extract UUID from URL
  // Pattern: /api/bookings/{uuid}/details or /bookings/{uuid}/details
  const urlMatch = trimmed.match(/\/bookings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (urlMatch && urlMatch[1]) {
    console.log('[QR Extract] Found UUID in URL format');
    return urlMatch[1];
  }

  // LEGACY: Try to find UUID anywhere in the string
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch && uuidMatch[0]) {
    console.log('[QR Extract] Found UUID in string');
    return uuidMatch[0];
  }

  console.log('[QR Extract] No valid booking ID found in QR content');
  return null;
}

/**
 * Parse QR code content for external display
 * Returns structured booking data if QR contains JSON, null otherwise
 * SECURITY: This function does NOT return payment_status or status fields
 * Those are only available server-side for cashier scanner
 */
export function parseQRContentForDisplay(qrContent: string): {
  booking_id: string;
  service?: string;
  service_ar?: string;
  date?: string;
  time?: string;
  tenant?: string;
  tenant_ar?: string;
  customer?: string;
  price?: number;
  quantity?: number;
} | null {
  if (!qrContent || typeof qrContent !== 'string') {
    return null;
  }

  const trimmed = qrContent.trim();
  
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.booking_id && parsed.type === 'booking_ticket') {
      // Return only ticket details, exclude status/payment fields
      return {
        booking_id: parsed.booking_id,
        service: parsed.service,
        service_ar: parsed.service_ar,
        date: parsed.date,
        time: parsed.time,
        tenant: parsed.tenant,
        tenant_ar: parsed.tenant_ar,
        customer: parsed.customer,
        price: parsed.price,
        quantity: parsed.quantity
      };
    }
  } catch (e) {
    // Not JSON format
  }
  
  return null;
}
