/**
 * Server-Side Currency Utilities
 * 
 * Currency formatting for backend services (PDF, emails, etc.)
 */

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  name_ar: string;
  symbolPosition: 'before' | 'after';
  decimalPlaces: number;
  thousandsSeparator: string;
  decimalSeparator: string;
}

export const CURRENCIES: Record<string, Currency> = {
  SAR: {
    code: 'SAR',
    symbol: 'ر.س',
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

export const DEFAULT_CURRENCY = CURRENCIES.SAR;

export function getCurrency(code: string): Currency {
  return CURRENCIES[code.toUpperCase()] || DEFAULT_CURRENCY;
}

export function formatCurrency(
  amount: number | string,
  currencyCode: string = 'SAR',
  options: {
    showSymbol?: boolean;
    showDecimals?: boolean;
  } = {}
): string {
  const currency = getCurrency(currencyCode);
  const {
    showSymbol = true,
    showDecimals = true,
  } = options;

  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return showSymbol 
      ? (currency.symbolPosition === 'before' ? `${currency.symbol}0` : `0 ${currency.symbol}`)
      : '0';
  }

  const parts = numAmount.toFixed(currency.decimalPlaces).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, currency.thousandsSeparator);
  
  const formattedNumber = showDecimals
    ? `${formattedInteger}${currency.decimalSeparator}${decimalPart}`
    : formattedInteger;

  if (!showSymbol) {
    return formattedNumber;
  }

  if (currency.symbolPosition === 'before') {
    return `${currency.symbol}${formattedNumber}`;
  } else {
    return `${formattedNumber} ${currency.symbol}`;
  }
}
