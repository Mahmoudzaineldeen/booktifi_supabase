import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber } from '../../server/src/utils/normalizePhoneNumber';

describe('normalizePhoneNumber', () => {
  it('keeps egypt behavior: removes 0 after +20', () => {
    expect(normalizePhoneNumber('+2001032560826')).toBe('+201032560826');
  });

  it('normalizes saudi +9660 to +966', () => {
    expect(normalizePhoneNumber('+9660532560826')).toBe('+966532560826');
  });

  it('normalizes local saudi 05 to +9665', () => {
    expect(normalizePhoneNumber('0532560826')).toBe('+966532560826');
  });

  it('normalizes saudi code without plus', () => {
    expect(normalizePhoneNumber('9660532560826')).toBe('+966532560826');
  });
});

