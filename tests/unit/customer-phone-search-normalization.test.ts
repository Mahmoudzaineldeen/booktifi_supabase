import { describe, it, expect } from 'vitest';
import {
  bestPhoneMatchScore,
  buildDigitFuzzyPattern,
  buildSearchDigitVariants,
  normalizePhoneDigits,
  phoneMatchesAnyVariant,
} from '../../server/src/utils/customerPhoneSearch';

describe('customer phone search normalization', () => {
  it('builds local/international variants for Saudi numbers', () => {
    const variants = buildSearchDigitVariants('0531');
    expect(variants).toContain('0531');
    expect(variants).toContain('531');
    expect(variants).toContain('966531');
    expect(variants).toContain('00966531');
  });

  it('matches local query against international stored phone', () => {
    const variants = buildSearchDigitVariants('0531');
    const storedPhone = '+966531234567';
    expect(phoneMatchesAnyVariant(storedPhone, variants)).toBe(true);
  });

  it('fuzzy pattern supports formatted phone strings with separators', () => {
    expect(buildDigitFuzzyPattern('531')).toBe('%5%3%1%');
    expect(normalizePhoneDigits('+966 53 123 4567')).toBe('966531234567');
  });

  it('scores startsWith higher than contains', () => {
    const variants = buildSearchDigitVariants('0531');
    const scoreStartsWith = bestPhoneMatchScore('+966531234567', variants);
    const scoreContains = bestPhoneMatchScore('+966501531234', variants);
    expect(scoreStartsWith).toBeLessThanOrEqual(scoreContains);
  });
});
