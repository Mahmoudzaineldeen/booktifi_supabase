/**
 * Currency Display Component
 * 
 * Displays formatted currency with proper symbol/icon rendering
 */

import React from 'react';
import { useCurrency } from '../../contexts/CurrencyContext';
import { CurrencySymbol } from './CurrencySymbol';
import { formatCurrency, getCurrency } from '../../lib/currency';

interface CurrencyDisplayProps {
  amount: number | string;
  showSymbol?: boolean;
  showDecimals?: boolean;
  className?: string;
  symbolSize?: number;
}

export function CurrencyDisplay({
  amount,
  showSymbol = true,
  showDecimals = true,
  className = '',
  symbolSize = 16,
}: CurrencyDisplayProps) {
  const { currencyCode } = useCurrency();
  const currency = getCurrency(currencyCode);

  // Convert to number
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(numAmount)) {
    return (
      <span className={className}>
        {showSymbol && currencyCode === 'SAR' ? (
          <>
            0 <CurrencySymbol currencyCode={currencyCode} size={symbolSize} />
          </>
        ) : (
          formatCurrency(0, currencyCode, { showSymbol, showDecimals })
        )}
      </span>
    );
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

  // Render with icon for SAR, text for others
  if (!showSymbol) {
    return <span className={className}>{formattedNumber}</span>;
  }

  if (currencyCode === 'SAR') {
    // SAR uses icon
    return (
      <span className={className}>
        {formattedNumber} <CurrencySymbol currencyCode={currencyCode} size={symbolSize} />
      </span>
    );
  }

  // Other currencies use text symbol
  if (currency.symbolPosition === 'before') {
    return (
      <span className={className}>
        {currency.symbol}{formattedNumber}
      </span>
    );
  } else {
    return (
      <span className={className}>
        {formattedNumber} {currency.symbol}
      </span>
    );
  }
}
