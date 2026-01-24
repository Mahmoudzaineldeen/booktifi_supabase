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
  formatPrice: (amount: number | string, options?: { showSymbol?: boolean; showDecimals?: boolean }) => string;
  getSymbol: () => string;
  refreshCurrency: () => Promise<void>;
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
   */
  const formatPrice = useCallback((
    amount: number | string,
    options?: { showSymbol?: boolean; showDecimals?: boolean }
  ): string => {
    return formatCurrency(amount, currencyCode, options);
  }, [currencyCode]);

  /**
   * Get currency symbol
   */
  const getSymbol = useCallback((): string => {
    return currency.symbol;
  }, [currency]);

  const value: CurrencyContextType = {
    currency,
    currencyCode,
    isLoading,
    formatPrice,
    getSymbol,
    refreshCurrency,
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
