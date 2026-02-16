/**
 * Centralized time formatting for display only.
 * Database continues to store time in 24-hour format (e.g. "13:00", "18:30").
 * Use these helpers when displaying to users in the UI, PDFs, and notifications.
 */

import { format } from 'date-fns';

/**
 * Format a time string (HH:mm or HH:mm:ss) or Date to 12-hour display.
 * Examples:
 *   "13:00" → "1:00 PM"
 *   "00:30" → "12:30 AM"
 *   "12:00" → "12:00 PM"
 *   "23:59" → "11:59 PM"
 */
export function formatTimeTo12Hour(time: string | Date): string {
  if (time == null || time === '') return '';

  let hours: number;
  let minutes: number;

  if (typeof time === 'string') {
    const parts = time.trim().split(':');
    hours = parseInt(parts[0] ?? '0', 10);
    minutes = parseInt(parts[1] ?? '0', 10);
    if (isNaN(hours) || hours < 0 || hours > 23 || isNaN(minutes) || minutes < 0 || minutes > 59) {
      return time; // fallback to original if invalid
    }
  } else {
    const d = time instanceof Date ? time : new Date(time);
    if (Number.isNaN(d.getTime())) return '';
    hours = d.getHours();
    minutes = d.getMinutes();
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const minStr = String(minutes).padStart(2, '0');
  return `${hour12}:${minStr} ${period}`;
}

/**
 * Format a full datetime to 12-hour for display (e.g. "MMM dd, yyyy 1:00 PM").
 * Use when showing created_at, zoho_invoice_created_at, qr_scanned_at, etc.
 */
export function formatDateTimeTo12Hour(
  dateTime: string | Date,
  options?: { locale?: { code?: string }; dateFormat?: string }
): string {
  if (dateTime == null || dateTime === '') return '';
  const d = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
  if (Number.isNaN(d.getTime())) return '';
  const locale = options?.locale;
  const datePart = format(d, options?.dateFormat ?? 'MMM dd, yyyy', { locale: locale as any });
  const timePart = formatTimeTo12Hour(d);
  return `${datePart} ${timePart}`;
}
