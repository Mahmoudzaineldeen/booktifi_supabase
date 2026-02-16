/**
 * Server-side time formatting for display only (PDFs, emails, QR payload, notifications).
 * Database continues to store time in 24-hour format. Use this when outputting to users.
 */

/**
 * Format HH:mm or HH:mm:ss to 12-hour display.
 * "13:00" → "1:00 PM", "00:30" → "12:30 AM", "12:00" → "12:00 PM"
 */
export function formatTimeTo12Hour(timeString: string): string {
  if (!timeString || typeof timeString !== 'string') return '';
  const parts = timeString.trim().split(':');
  const hours = parseInt(parts[0] ?? '0', 10);
  const minutes = parseInt(parts[1] ?? '0', 10);
  if (isNaN(hours) || hours < 0 || hours > 23 || isNaN(minutes) || minutes < 0 || minutes > 59) {
    return timeString;
  }
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const minStr = String(minutes).padStart(2, '0');
  return `${hour12}:${minStr} ${period}`;
}
