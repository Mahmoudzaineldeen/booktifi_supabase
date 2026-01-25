/**
 * Helper functions for translating status values
 * 
 * IMPORTANT: These functions use safeTranslate to ensure translation keys
 * NEVER appear in the UI. If a translation is missing, a human-readable
 * fallback is returned.
 */

import { safeTranslateStatus } from './safeTranslation';

export function translateBookingStatus(status: string, t: (key: string) => string): string {
  return safeTranslateStatus(t, status, 'booking');
}

export function translatePaymentStatus(status: string, t: (key: string) => string): string {
  return safeTranslateStatus(t, status, 'payment');
}
