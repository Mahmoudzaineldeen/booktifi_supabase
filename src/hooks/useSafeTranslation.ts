/**
 * Safe Translation Hook
 * 
 * Wraps useTranslation to ensure translation keys NEVER appear in the UI.
 * All translations go through safeTranslate to guarantee human-readable output.
 */

import { useTranslation as useI18nTranslation } from 'react-i18next';
import { safeTranslate, safeTranslateStatus, safeTranslateNested } from '../lib/safeTranslation';
import i18n from '../lib/i18n';

export function useSafeTranslation() {
  const { t: originalT, i18n: i18nInstance, ...rest } = useI18nTranslation();

  // Wrap t function to always use safe translation
  const safeT = (key: string, fallback?: string, options?: any): string => {
    // First try to get translation
    const translation = originalT(key, options);
    
    // If translation is missing or is the key itself, use safe translate
    if (!translation || translation === key || /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(translation)) {
      return safeTranslate(originalT, key, fallback);
    }
    
    return translation;
  };

  // Helper for status translations
  const safeTStatus = (status: string, type: 'booking' | 'payment' = 'booking'): string => {
    return safeTranslateStatus(originalT, status, type);
  };

  // Helper for nested translations
  const safeTNested = (baseKey: string, value: string, fallback?: string): string => {
    return safeTranslateNested(originalT, baseKey, value, fallback);
  };

  return {
    t: safeT,
    tStatus: safeTStatus,
    tNested: safeTNested,
    i18n: i18nInstance,
    ...rest,
  };
}
