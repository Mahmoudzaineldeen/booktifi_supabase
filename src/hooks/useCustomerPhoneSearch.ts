/**
 * Search existing customers by phone fragment (for Add Booking / Add Subscription).
 * Backend: GET /bookings/customer-search?phone=digits&limit=n (LIKE '%digits%').
 * Shows up to MAX_SHOW suggestions and lets user scroll the dropdown.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl } from '../lib/apiUrl';
import { normalizePhoneNumber } from '../lib/normalizePhoneNumber';

export interface CustomerSuggestion {
  id?: string;
  name: string;
  phone: string;
  email?: string | null;
}

const DEBOUNCE_MS = 400;
/** Min digits before hitting API. 3 is too loose for +966 (matches almost all Saudi numbers → slow/timeouts in prod). */
const MIN_DIGITS = 4;
const MAX_SHOW = 100;
const LIMIT = 120;

export function buildCustomerPhoneQueryVariants(input: string): string[] {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return [];

  const set = new Set<string>();
  const add = (v: string) => {
    const n = String(v || '').replace(/\D/g, '');
    if (n.length >= 3) set.add(n);
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
    // Saudi trunk 0 after 966: 9660532… ↔ 966532… (must match server buildSearchDigitVariants)
    if (local.startsWith('0') && local.length >= 2) {
      add(`966${local.slice(1)}`);
    }
    if (!local.startsWith('0') && local.startsWith('5') && local.length >= 2) {
      add(`9660${local}`);
    }
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

function digitsOnly(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

/** Same idea as server `canonicalPhoneDigitsOnly` — merge +966053… with +966532… */
export function canonicalPhoneDigitsOnly(phone: string): string {
  const d = digitsOnly(phone);
  if (!d) return '';
  const trimmed = phone.trim();
  const n =
    normalizePhoneNumber(trimmed.startsWith('+') ? trimmed : `+${d}`) || normalizePhoneNumber(d);
  return n ? digitsOnly(n) : d;
}

function dedupeSuggestionsByCanonicalPhone(list: CustomerSuggestion[]): CustomerSuggestion[] {
  const byCanon = new Map<string, CustomerSuggestion[]>();
  for (const c of list) {
    const canon = canonicalPhoneDigitsOnly(c.phone);
    if (!canon || canon.length < 3) continue;
    if (!byCanon.has(canon)) byCanon.set(canon, []);
    byCanon.get(canon)!.push(c);
  }

  const out: CustomerSuggestion[] = [];
  for (const [, group] of byCanon) {
    group.sort((a, b) => {
      const sa = (a.id ? 4 : 0) + (a.email ? 2 : 0);
      const sb = (b.id ? 4 : 0) + (b.email ? 2 : 0);
      return sb - sa;
    });
    const chosen = group[0];
    const canon = canonicalPhoneDigitsOnly(chosen.phone);
    const pretty = normalizePhoneNumber(`+${canon}`) || chosen.phone;
    const name = group.map((r) => (r.name || '').trim()).find((n) => n.length > 0) || chosen.name || '';
    const id = group.find((r) => r.id)?.id ?? chosen.id;
    const email = group.find((r) => r.email)?.email ?? chosen.email ?? null;
    out.push({
      id,
      name,
      email,
      phone: typeof pretty === 'string' && pretty.startsWith('+') ? pretty : chosen.phone,
    });
  }
  return out;
}

export function rankAndLimitCustomerSuggestions(
  list: CustomerSuggestion[],
  digits: string,
  maxShow: number
): CustomerSuggestion[] {
  const queryDigits = digits.replace(/\D/g, '');
  const normalized = list
    .filter((c) => !!c?.phone)
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

  const merged = normalized.map(({ _digits, ...rest }) => rest);
  const deduped = dedupeSuggestionsByCanonicalPhone(merged);

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
      const variants = buildCustomerPhoneQueryVariants(digits).filter(
        (v) => digitsOnly(v).length >= MIN_DIGITS
      );
      if (variants.length === 0) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
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
