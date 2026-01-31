/**
 * Search existing customers by phone fragment (for Add Booking / Add Subscription).
 * Backend: GET /bookings/customer-search?phone=digits (LIKE '%digits%' LIMIT 11).
 * Only show suggestions when 1 <= results <= 10 (hide if 0 or >10).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl } from '../lib/apiUrl';

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
}

const DEBOUNCE_MS = 400;
const MIN_DIGITS = 5;
const MAX_SHOW = 10;
const LIMIT = 11;

export function useCustomerPhoneSearch(tenantId: string | undefined, fullPhoneValue: string) {
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (digits: string) => {
    if (!tenantId || digits.length < MIN_DIGITS) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setSuggestions([]);
    try {
      const token = localStorage.getItem('auth_token');
      const url = `${getApiUrl()}/bookings/customer-search?phone=${encodeURIComponent(digits)}`;
      const res = await fetch(url, {
        headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        setSuggestions([]);
        return;
      }
      const data = await res.json();
      const list: CustomerSuggestion[] = data.customers || [];
      // Only show dropdown when 1 <= count <= 10 (if 11 returned, too many)
      if (list.length > MAX_SHOW) {
        setSuggestions([]);
      } else {
        setSuggestions(list);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setSuggestions([]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [tenantId]);

  useEffect(() => {
    const digits = (fullPhoneValue || '').replace(/\D/g, '');
    if (digits.length < MIN_DIGITS) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      search(digits);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [fullPhoneValue, search]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  return { suggestions, loading, clearSuggestions };
}
