/**
 * Currency Context
 * 
 * Provides global currency state and utilities for the entire application.
 * Currency is loaded from tenant settings and persists across the app.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { db } from '../lib/db';
import { getCurrency, formatCurrency, type Currency, DEFAULT_CURRENCY } from '../lib/currency';

interface CurrencyContextType {
  currency: Currency;
  currencyCode: string;
  isLoading: boolean;
  formatPrice: (amount: number | string, options?: { showSymbol?: boolean; showDecimals?: boolean }) => string | React.ReactNode;
  formatPriceString: (amount: number | string, options?: { showSymbol?: boolean; showDecimals?: boolean }) => string; // Always returns string
  getSymbol: () => string;
  getSymbolJSX: () => React.ReactNode; // Returns JSX for SAR icon, string for others
  refreshCurrency: () => Promise<void>;
  // Helper to check if currency uses an icon
  hasIcon: () => boolean;
  getIconUrl: () => string | undefined;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { userProfile } = useAuth();
  const [currencyCode, setCurrencyCode] = useState<string>('SAR');
  const [isLoading, setIsLoading] = useState(true);
  const currency = getCurrency(currencyCode);

  /**
   * Fetch currency from tenant settings
   */
  const fetchCurrency = useCallback(async () => {
    if (!userProfile?.tenant_id) {
      setCurrencyCode('SAR');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await db
        .from('tenants')
        .select('currency_code')
        .eq('id', userProfile.tenant_id)
        .single();

      if (error) {
        console.warn('[Currency] Error fetching currency, using default:', error);
        setCurrencyCode('SAR');
      } else if (data?.currency_code) {
        setCurrencyCode(data.currency_code);
      } else {
        setCurrencyCode('SAR'); // Default fallback
      }
    } catch (err) {
      console.error('[Currency] Error fetching currency:', err);
      setCurrencyCode('SAR');
    } finally {
      setIsLoading(false);
    }
  }, [userProfile?.tenant_id]);

  /**
   * Refresh currency (called after currency change)
   */
  const refreshCurrency = useCallback(async () => {
    setIsLoading(true);
    await fetchCurrency();
  }, [fetchCurrency]);

  // Load currency on mount and when tenant changes
  useEffect(() => {
    fetchCurrency();
  }, [fetchCurrency]);

  /**
   * Format price using current tenant currency
   * Returns JSX.Element for SAR (with icon) or string for other currencies
   */
  const formatPrice = useCallback((
    amount: number | string,
    options?: { showSymbol?: boolean; showDecimals?: boolean }
  ): string | React.ReactNode => {
    // For SAR with icon, return JSX
    if (currencyCode === 'SAR' && currency.iconUrl && (options?.showSymbol !== false)) {
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      const currencyData = getCurrency(currencyCode);
      
      if (isNaN(numAmount)) {
        return (
          <>
            0 <img 
              src={currency.iconUrl} 
              alt="SAR" 
              style={{ 
                width: 18, 
                height: 18, 
                display: 'inline-block', 
                verticalAlign: 'middle',
                marginLeft: '3px',
                objectFit: 'contain'
              }} 
            />
          </>
        );
      }

      const parts = numAmount.toFixed(currencyData.decimalPlaces).split('.');
      const integerPart = parts[0];
      const decimalPart = parts[1];
      const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, currencyData.thousandsSeparator);
      const formattedNumber = options?.showDecimals !== false
        ? `${formattedInteger}${currencyData.decimalSeparator}${decimalPart}`
        : formattedInteger;

      return (
        <>
          {formattedNumber} <img 
            src={currency.iconUrl} 
            alt="SAR" 
            style={{ 
              width: 18, 
              height: 18, 
              display: 'inline-block', 
              verticalAlign: 'middle', 
              marginLeft: '3px',
              objectFit: 'contain'
            }} 
          />
        </>
      );
    }

    // For other currencies or when showSymbol is false, return string
    return formatCurrency(amount, currencyCode, options);
  }, [currencyCode, currency]);

  /**
   * Format price as string (always returns string, even for SAR)
   * Use this when you need string operations like .replace()
   */
  const formatPriceString = useCallback((
    amount: number | string,
    options?: { showSymbol?: boolean; showDecimals?: boolean }
  ): string => {
    return formatCurrency(amount, currencyCode, options);
  }, [currencyCode]);

  /**
   * Get currency symbol as string
   */
  const getSymbol = useCallback((): string => {
    return currency.symbol;
  }, [currency]);

  /**
   * Get currency symbol as JSX (icon for SAR, string for others)
   */
  const getSymbolJSX = useCallback((): React.ReactNode => {
    if (currencyCode === 'SAR' && currency.iconUrl) {
      return (
        <img 
          src={currency.iconUrl} 
          alt="SAR" 
          style={{ 
            width: 18, 
            height: 18, 
            display: 'inline-block', 
            verticalAlign: 'middle',
            objectFit: 'contain'
          }} 
        />
      );
    }
    return currency.symbol;
  }, [currencyCode, currency]);

  /**
   * Check if currency has an icon
   */
  const hasIcon = useCallback((): boolean => {
    return !!currency.iconUrl;
  }, [currency]);

  /**
   * Get icon URL if available
   */
  const getIconUrl = useCallback((): string | undefined => {
    return currency.iconUrl;
  }, [currency]);

  const value: CurrencyContextType = {
    currency,
    currencyCode,
    isLoading,
    formatPrice,
    formatPriceString,
    getSymbol,
    getSymbolJSX,
    refreshCurrency,
    hasIcon,
    getIconUrl,
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

/**
 * Hook to use currency context
 */
export function useCurrency(): CurrencyContextType {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
