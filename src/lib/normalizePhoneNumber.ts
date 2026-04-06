/**
 * Same logic as server/src/utils/normalizePhoneNumber.ts — used client-side for suggestion dedupe.
 */
export function normalizePhoneNumber(value: string): string | null {
  if (!value || typeof value !== 'string') return null;

  let cleaned = value.replace(/[\s\-\(\)]/g, '');

  const normalizeEgyptLocal = (digitsAfterCode: string): string | null => {
    if (digitsAfterCode.startsWith('0') && digitsAfterCode.length >= 10) {
      const withoutZero = digitsAfterCode.substring(1);
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        return `+20${withoutZero}`;
      }
    }
    if (digitsAfterCode.length === 10 && (digitsAfterCode.startsWith('1') || digitsAfterCode.startsWith('2') || digitsAfterCode.startsWith('5'))) {
      return `+20${digitsAfterCode}`;
    }
    return null;
  };

  const normalizeSaudiLocal = (digitsAfterCode: string): string | null => {
    if (digitsAfterCode.startsWith('0') && digitsAfterCode.length >= 10) {
      const withoutZero = digitsAfterCode.substring(1);
      if (withoutZero.length === 9 && withoutZero.startsWith('5')) {
        return `+966${withoutZero}`;
      }
    }
    if (digitsAfterCode.length === 9 && digitsAfterCode.startsWith('5')) {
      return `+966${digitsAfterCode}`;
    }
    return null;
  };

  if (cleaned.startsWith('+')) {
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3);
      return normalizeEgyptLocal(afterCode) || cleaned;
    }
    if (cleaned.startsWith('+966')) {
      const afterCode = cleaned.substring(4);
      return normalizeSaudiLocal(afterCode) || cleaned;
    }
    return cleaned;
  }

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3);
      return normalizeEgyptLocal(afterCode) || cleaned;
    }
    if (cleaned.startsWith('+966')) {
      const afterCode = cleaned.substring(4);
      return normalizeSaudiLocal(afterCode) || cleaned;
    }
    return cleaned;
  }

  if (cleaned.startsWith('20') && cleaned.length >= 12) {
    const afterCode = cleaned.substring(2);
    return normalizeEgyptLocal(afterCode) || `+${cleaned}`;
  }
  if (cleaned.startsWith('966') && cleaned.length >= 12) {
    const afterCode = cleaned.substring(3);
    return normalizeSaudiLocal(afterCode) || `+${cleaned}`;
  }

  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
      return `+20${withoutZero}`;
    }
  }
  if (cleaned.startsWith('05') && cleaned.length === 10) {
    return `+966${cleaned.substring(1)}`;
  }

  if (cleaned.length === 10 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }
  if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return `+966${cleaned}`;
  }

  return null;
}
