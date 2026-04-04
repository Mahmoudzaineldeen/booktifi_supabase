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
const MIN_DIGITS = 3;
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
      const queryDigits = digits.replace(/\D/g, '');
      const normalized = list
        .filter((c) => !!c?.id && !!c?.phone)
        .map((c) => ({
          ...c,
          _digits: c.phone.replace(/\D/g, ''),
        }));
      // Accuracy: show closest matches first (exact > startsWith > contains),
      // then by shorter phone length to reduce noisy suggestions.
      normalized.sort((a, b) => {
        const score = (x: { _digits: string }) => {
          if (x._digits === queryDigits) return 0;
          if (x._digits.startsWith(queryDigits)) return 1;
          if (x._digits.includes(queryDigits)) return 2;
          return 3;
        };
        const sA = score(a);
        const sB = score(b);
        if (sA !== sB) return sA - sB;
        return a._digits.length - b._digits.length;
      });
      const deduped: CustomerSuggestion[] = [];
      const seen = new Set<string>();
      for (const item of normalized) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        deduped.push({
          id: item.id,
          name: item.name,
          phone: item.phone,
          email: item.email,
        });
      }
      // Only show dropdown when 1 <= count <= 10 (if 11 returned, too many)
      if (deduped.length > MAX_SHOW) {
        setSuggestions([]);
      } else {
        setSuggestions(deduped);
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
