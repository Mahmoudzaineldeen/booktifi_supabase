import { describe, it, expect } from 'vitest';
import {
  buildSearchDigitVariants,
  phoneMatchesAnyVariant,
} from '../../server/src/utils/customerPhoneSearch';

describe('customerPhoneSearch (server)', () => {
  it('adds 966532… variant when digits contain 966053… (Saudi trunk zero after country code)', () => {
    const v = buildSearchDigitVariants('96605325608');
    expect(v).toContain('9665325608');
  });

  it('matches E.164 stored phone when search uses 9660… fragment', () => {
    const variants = buildSearchDigitVariants('9660532');
    expect(phoneMatchesAnyVariant('+966532560826', variants)).toBe(true);
  });

  it('matches when DB row has mistaken 9660… but canonical is 9665…', () => {
    const variants = buildSearchDigitVariants('966532');
    expect(phoneMatchesAnyVariant('+9660532560826', variants)).toBe(true);
  });
});
