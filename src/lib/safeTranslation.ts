/**
 * Safe Translation Helper
 * 
 * Ensures that translation keys NEVER appear in the UI.
 * If a translation is missing, falls back to a human-readable value.
 */

// Note: We can't import i18n here as it would create a circular dependency
// Instead, we'll get the language from the t function's context or use a default

/**
 * Default fallback translations for common statuses and values
 * These are used when translation keys are missing
 */
const DEFAULT_FALLBACKS: Record<string, Record<string, string>> = {
  en: {
    // Booking statuses
    'pending': 'Pending',
    'confirmed': 'Confirmed',
    'checked_in': 'Checked In',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    
    // Payment statuses
    'unpaid': 'Unpaid',
    'paid': 'Paid',
    'paid_manual': 'Paid (Manual)',
    'awaiting_payment': 'Awaiting Payment',
    'refunded': 'Refunded',
    
    // Common
    'loading': 'Loading...',
    'error': 'Error',
    'success': 'Success',
    'save': 'Save',
    'cancel': 'Cancel',
    'delete': 'Delete',
    'edit': 'Edit',
    'add': 'Add',
    'confirm': 'Confirm',
    'close': 'Close',
    'back': 'Back',
    'next': 'Next',
    'yes': 'Yes',
    'no': 'No',
    'ok': 'OK',
  },
  ar: {
    // Booking statuses
    'pending': 'قيد الانتظار',
    'confirmed': 'مؤكد',
    'checked_in': 'تم تسجيل الدخول',
    'completed': 'مكتمل',
    'cancelled': 'ملغي',
    
    // Payment statuses
    'unpaid': 'غير مدفوع',
    'paid': 'مدفوع',
    'paid_manual': 'مدفوع (يدوي)',
    'awaiting_payment': 'في انتظار الدفع',
    'refunded': 'مسترد',
    
    // Common
    'loading': 'جاري التحميل...',
    'error': 'خطأ',
    'success': 'نجح',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'delete': 'حذف',
    'edit': 'تعديل',
    'add': 'إضافة',
    'confirm': 'تأكيد',
    'close': 'إغلاق',
    'back': 'رجوع',
    'next': 'التالي',
    'yes': 'نعم',
    'no': 'لا',
    'ok': 'موافق',
  },
};

/**
 * Checks if a string looks like a translation key (contains dots and lowercase)
 */
function isTranslationKey(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  // Pattern: contains dots, lowercase letters, underscores
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(str);
}

/**
 * Safe translation function that NEVER returns a key
 * 
 * @param t - The i18n translation function
 * @param key - The translation key
 * @param fallback - Optional fallback text (if not provided, uses default fallbacks)
 * @returns A human-readable string, never a translation key
 */
export function safeTranslate(
  t: (key: string) => string,
  key: string,
  fallback?: string
): string {
  if (!key) return fallback || '';
  
  // Try to get translation
  const translation = t(key);
  
  // If translation exists and is not the key itself, return it
  if (translation && translation !== key && !isTranslationKey(translation)) {
    return translation;
  }
  
  // If we have a custom fallback, use it
  if (fallback && !isTranslationKey(fallback)) {
    return fallback;
  }
  
  // Try to extract the last part of the key (e.g., 'status.pending' -> 'pending')
  const keyParts = key.split('.');
  const lastPart = keyParts[keyParts.length - 1];
  
  // Check default fallbacks
  // Try to detect language from the translation result or use 'en' as default
  // We'll check if the translation looks Arabic (contains Arabic characters)
  const looksLikeArabic = /[\u0600-\u06FF]/.test(translation);
  const currentLang = looksLikeArabic ? 'ar' : 'en';
  const langFallbacks = DEFAULT_FALLBACKS[currentLang] || DEFAULT_FALLBACKS.en;
  
  if (langFallbacks[lastPart]) {
    return langFallbacks[lastPart];
  }
  
  // If still no fallback, try English
  if (currentLang !== 'en' && DEFAULT_FALLBACKS.en[lastPart]) {
    return DEFAULT_FALLBACKS.en[lastPart];
  }
  
  // Last resort: format the key part as a readable string
  // Convert 'checked_in' -> 'Checked In'
  const readable = lastPart
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return readable;
}

/**
 * Safe status translation - specifically for booking/payment statuses
 */
export function safeTranslateStatus(
  t: (key: string) => string,
  status: string,
  type: 'booking' | 'payment' = 'booking'
): string {
  if (!status) return '';
  
  // Try status.X first
  const statusKey = `status.${status}`;
  let result = safeTranslate(t, statusKey);
  
  // If that didn't work, try booking.X or payment.X
  if (isTranslationKey(result) || result === status) {
    const typeKey = type === 'booking' ? `booking.${status}` : `payment.${status}`;
    result = safeTranslate(t, typeKey);
  }
  
  // Final fallback to direct status value
  if (isTranslationKey(result) || result === status) {
    result = safeTranslate(t, status, status);
  }
  
  return result;
}

/**
 * Safe dynamic translation - for template strings like `status.${value}`
 */
export function safeTranslateDynamic(
  t: (key: string) => string,
  keyTemplate: string,
  value: string,
  fallback?: string
): string {
  const fullKey = keyTemplate.replace('${value}', value).replace('${status}', value).replace('${type}', value);
  return safeTranslate(t, fullKey, fallback);
}

/**
 * Safe translation for nested keys like admin.industries.${industry}
 */
export function safeTranslateNested(
  t: (key: string) => string,
  baseKey: string,
  value: string,
  fallback?: string
): string {
  const fullKey = `${baseKey}.${value}`;
  const result = safeTranslate(t, fullKey, fallback);
  
  // If still a key, try to format the value as readable text
  if (isTranslationKey(result) || result === fullKey) {
    if (fallback && !isTranslationKey(fallback)) {
      return fallback;
    }
    // Format value: 'healthcare' -> 'Healthcare'
    return value
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  return result;
}
