/**
 * Currency Symbol Component
 * 
 * Renders currency symbol as text or icon (for SAR)
 */

import React from 'react';

interface CurrencySymbolProps {
  currencyCode: string;
  className?: string;
  size?: number;
}

export function CurrencySymbol({ currencyCode, className = '', size = 16 }: CurrencySymbolProps) {
  if (currencyCode === 'SAR') {
    return (
      <img
        src="/assets/currency/sar-icon.png"
        alt="SAR"
        className={className}
        style={{ 
          width: size, 
          height: size, 
          display: 'inline-block', 
          verticalAlign: 'middle',
          objectFit: 'contain'
        }}
        onError={(e) => {
          // Fallback to text if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const fallback = document.createElement('span');
          fallback.textContent = 'ر.س';
          fallback.className = className;
          target.parentNode?.appendChild(fallback);
        }}
      />
    );
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
