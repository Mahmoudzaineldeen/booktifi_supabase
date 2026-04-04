/**
 * Search existing customers by phone fragment (for Add Booking / Add Subscription).
 * Backend: GET /bookings/customer-search?phone=digits&limit=n (LIKE '%digits%').
 * Shows up to MAX_SHOW suggestions and lets user scroll the dropdown.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl } from '../lib/apiUrl';

export interface CustomerSuggestion {
  id?: string;
  name: string;
  phone: string;
  email?: string | null;
}

const DEBOUNCE_MS = 400;
const MIN_DIGITS = 3;
const MAX_SHOW = 100;
const LIMIT = 120;

export function buildCustomerPhoneQueryVariants(input: string): string[] {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return [];

  const set = new Set<string>();
  const add = (v: string) => {
    const n = String(v || '').replace(/\D/g, '');
    if (n.length >= MIN_DIGITS) set.add(n);
  };

  const trimmedLeadingZeros = digits.replace(/^0+/, '');
  add(digits);
  add(trimmedLeadingZeros);

  if (digits.startsWith('0') && trimmedLeadingZeros) {
    add(`966${trimmedLeadingZeros}`);
    add(`00966${trimmedLeadingZeros}`);
  }
  if (digits.startsWith('966') && digits.length > 3) {
    const local = digits.slice(3);
    const localTrimmed = local.replace(/^0+/, '');
    add(local);
    add(localTrimmed);
    if (localTrimmed) add(`0${localTrimmed}`);
  }
  if (digits.startsWith('00966') && digits.length > 5) {
    const local = digits.slice(5);
    const localTrimmed = local.replace(/^0+/, '');
    add(local);
    add(localTrimmed);
    if (localTrimmed) {
      add(`0${localTrimmed}`);
      add(`966${localTrimmed}`);
    }
  }

  return Array.from(set).slice(0, 6);
}

export function rankAndLimitCustomerSuggestions(
  list: CustomerSuggestion[],
  digits: string,
  maxShow: number
): CustomerSuggestion[] {
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
    const dedupeKey = item.id || `${item._digits}:${item.name || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push({
      id: item.id,
      name: item.name,
      phone: item.phone,
      email: item.email,
    });
  }

  return deduped.slice(0, maxShow);
}

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
      const variants = buildCustomerPhoneQueryVariants(digits);
      const urls = variants.map(
        (variant) =>
          `${getApiUrl()}/bookings/customer-search?phone=${encodeURIComponent(variant)}&limit=${LIMIT}&_=${Date.now()}`
      );
      const responses = await Promise.all(
        urls.map((url) =>
          fetch(url, {
            cache: 'no-store',
            headers: {
              ...(token && { Authorization: `Bearer ${token}` }),
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
            signal: abortRef.current?.signal,
          })
        )
      );
      const lists = await Promise.all(
        responses.map(async (res) => {
          if (!res.ok) return [] as CustomerSuggestion[];
          const data = await res.json();
          return (data.customers || []) as CustomerSuggestion[];
        })
      );
      const merged = lists.flat();
      setSuggestions(rankAndLimitCustomerSuggestions(merged, digits, MAX_SHOW));
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
