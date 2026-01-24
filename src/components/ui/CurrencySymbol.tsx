/**
 * Currency Symbol Component
 * 
 * Renders currency symbol as text or icon (for SAR)
 */

import React from 'react';
import { getCurrency } from '../../lib/currency';

interface CurrencySymbolProps {
  currencyCode: string;
  className?: string;
  size?: number;
}

export function CurrencySymbol({ currencyCode, className = '', size = 18 }: CurrencySymbolProps) {
  const currency = getCurrency(currencyCode);
  
  // For SAR, use icon if available
  if (currencyCode === 'SAR' && currency.iconUrl) {
    return (
      <img
        src={currency.iconUrl}
        alt="SAR"
        className={className}
        style={{ 
          width: size, 
          height: size, 
          display: 'inline-block', 
          verticalAlign: 'middle',
          objectFit: 'contain',
          marginLeft: '3px',
          imageRendering: 'auto'
        }}
        onError={(e) => {
          // Fallback to text if image fails to load
          console.error('[CurrencySymbol] Failed to load SAR icon, falling back to text');
          const target = e.target as HTMLImageElement;
          if (target.parentNode) {
            target.style.display = 'none';
            const fallback = document.createElement('span');
            fallback.textContent = currency.symbol;
            fallback.className = className;
            target.parentNode.appendChild(fallback);
          }
        }}
        onLoad={() => {
          if (process.env.NODE_ENV === 'development') {
            console.log('[CurrencySymbol] SAR icon loaded successfully');
          }
        }}
      />
    );
  }

  // For other currencies, return the text symbol
  return <span className={className}>{currency.symbol}</span>;
}
