/**
 * Global Currency System
 * 
 * Centralized currency definitions and utilities for the entire application.
 * This is the single source of truth for currency information.
 */

export interface Currency {
  code: string; // ISO 4217 code (SAR, USD, GBP, EUR)
  symbol: string; // Currency symbol ($, £, €, ر.س) - used as fallback or for non-React contexts
  iconUrl?: string; // Optional icon URL for currency symbol (e.g., SAR icon)
  name: string; // Display name in English
  name_ar: string; // Display name in Arabic
  symbolPosition: 'before' | 'after'; // Where symbol appears relative to number
  decimalPlaces: number; // Number of decimal places (usually 2)
  thousandsSeparator: string; // Thousands separator (comma, period, space)
  decimalSeparator: string; // Decimal separator (period, comma)
}

/**
 * Supported currencies with full configuration
 */
export const CURRENCIES: Record<string, Currency> = {
  SAR: {
    code: 'SAR',
    symbol: 'ر.س', // Fallback text symbol (used in non-React contexts like PDFs, emails)
    iconUrl: '/assets/currency/sar-icon.png', // Icon for React components
    name: 'Saudi Riyal',
    name_ar: 'ريال سعودي',
    symbolPosition: 'after',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'US Dollar',
    name_ar: 'دولار أمريكي',
    symbolPosition: 'before',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    name: 'British Pound',
    name_ar: 'جنيه إسترليني',
    symbolPosition: 'before',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    name_ar: 'يورو',
    symbolPosition: 'after',
    decimalPlaces: 2,
    thousandsSeparator: '.',
    decimalSeparator: ',',
  },
};

/**
 * Default currency (for backward compatibility)
 */
export const DEFAULT_CURRENCY = CURRENCIES.SAR;

/**
 * Get currency by code
 */
export function getCurrency(code: string): Currency {
  return CURRENCIES[code.toUpperCase()] || DEFAULT_CURRENCY;
}

/**
 * Format a number as currency
 * 
 * @param amount - The amount to format
 * @param currencyCode - ISO currency code (default: SAR)
 * @param options - Formatting options
 * @returns Formatted currency string
 * 
 * @example
 * formatCurrency(1000, 'SAR') // "1,000.00 ر.س"
 * formatCurrency(1000, 'USD') // "$1,000.00"
 * formatCurrency(1000, 'EUR') // "1.000,00 €"
 */
export function formatCurrency(
  amount: number | string,
  currencyCode: string = 'SAR',
  options: {
    showSymbol?: boolean;
    showDecimals?: boolean;
    locale?: 'en' | 'ar';
  } = {}
): string {
  const currency = getCurrency(currencyCode);
  const {
    showSymbol = true,
    showDecimals = true,
    locale = 'en',
  } = options;

  // Convert to number
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return showSymbol 
      ? (currency.symbolPosition === 'before' ? `${currency.symbol}0` : `0 ${currency.symbol}`)
      : '0';
  }

  // Format number with proper separators
  const parts = numAmount.toFixed(currency.decimalPlaces).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  // Add thousands separator
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, currency.thousandsSeparator);
  
  // Build formatted number
  const formattedNumber = showDecimals
    ? `${formattedInteger}${currency.decimalSeparator}${decimalPart}`
    : formattedInteger;

  // Add currency symbol
  if (!showSymbol) {
    return formattedNumber;
  }

  if (currency.symbolPosition === 'before') {
    return `${currency.symbol}${formattedNumber}`;
  } else {
    return `${formattedNumber} ${currency.symbol}`;
  }
}

/**
 * Get currency symbol only
 */
export function getCurrencySymbol(currencyCode: string = 'SAR'): string {
  return getCurrency(currencyCode).symbol;
}

/**
 * Get currency name
 */
export function getCurrencyName(currencyCode: string = 'SAR', locale: 'en' | 'ar' = 'en'): string {
  const currency = getCurrency(currencyCode);
  return locale === 'ar' ? currency.name_ar : currency.name;
}

/**
 * Get all available currencies as array
 */
export function getAvailableCurrencies(): Currency[] {
  return Object.values(CURRENCIES);
}
