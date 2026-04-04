import { describe, it, expect } from 'vitest';
import {
  buildCustomerPhoneQueryVariants,
  rankAndLimitCustomerSuggestions,
  type CustomerSuggestion,
} from '../../src/hooks/useCustomerPhoneSearch';
import { CUSTOMER_PHONE_SUGGESTIONS_SCROLL_CLASSES } from '../../src/components/reception/CustomerPhoneSuggestionsDropdown';

function makeCustomer(i: number): CustomerSuggestion {
  const suffix = String(i).padStart(4, '0');
  return {
    id: `cust-${i}`,
    name: `Customer ${i}`,
    phone: `+966055${suffix}`,
    email: `customer${i}@example.com`,
  };
}

describe('customer phone suggestions', () => {
  it('builds fallback query variants for country/local forms', () => {
    const variants = buildCustomerPhoneQueryVariants('9660531');
    expect(variants).toContain('9660531');
    expect(variants).toContain('531');
    expect(variants).toContain('0531');
  });

  it('keeps high-volume matches instead of hiding them', () => {
    const customers = Array.from({ length: 50 }, (_, i) => makeCustomer(i + 1));
    const result = rankAndLimitCustomerSuggestions(customers, '055', 100);

    expect(result).toHaveLength(50);
    expect(result[0]?.phone).toContain('055');
    expect(result[49]?.phone).toContain('055');
  });

  it('caps very large results to configured max', () => {
    const customers = Array.from({ length: 160 }, (_, i) => makeCustomer(i + 1));
    const result = rankAndLimitCustomerSuggestions(customers, '055', 100);
    expect(result).toHaveLength(100);
  });

  it('keeps booking-history suggestions even when id is missing', () => {
    const list: CustomerSuggestion[] = [
      { name: 'History Visitor', phone: '+966531234567', email: null },
      { id: 'cust-1', name: 'Master Customer', phone: '+966501111111', email: null },
    ];
    const result = rankAndLimitCustomerSuggestions(list, '0531', 100);
    expect(result.some((r) => r.phone === '+966531234567')).toBe(true);
  });

  it('dropdown classes include scroll behavior', () => {
    expect(CUSTOMER_PHONE_SUGGESTIONS_SCROLL_CLASSES).toContain('max-h-56');
    expect(CUSTOMER_PHONE_SUGGESTIONS_SCROLL_CLASSES).toContain('overflow-y-auto');
  });
});
