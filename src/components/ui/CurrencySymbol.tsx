/**
 * Currency Symbol Component
 * 
 * Renders currency symbol as text or icon (for SAR)
 */

import React from 'react';
import { SARIcon } from './SARIcon';

interface CurrencySymbolProps {
  currencyCode: string;
  className?: string;
  size?: number;
}

export function CurrencySymbol({ currencyCode, className = '', size = 18 }: CurrencySymbolProps) {
  if (currencyCode === 'SAR') {
    return <SARIcon size={size} className={className} />;
  }

  // For other currencies, return the text symbol
  const symbols: Record<string, string> = {
    USD: '$',
    GBP: '£',
    EUR: '€',
    SAR: 'ر.س', // Fallback if image fails to load
  };

  return <span className={className}>{symbols[currencyCode] || currencyCode}</span>;
}
