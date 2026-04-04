export function normalizePhoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function buildSearchDigitVariants(inputDigits: string): string[] {
  const raw = normalizePhoneDigits(inputDigits);
  if (!raw) return [];

  const set = new Set<string>();
  const trimmedLeadingZeros = raw.replace(/^0+/, '');

  const add = (v: string) => {
    const n = normalizePhoneDigits(v);
    if (n.length >= 3) set.add(n);
  };

  add(raw);
  add(trimmedLeadingZeros);

  // Local -> KSA international variants (0xxxxxxxxx -> 966xxxxxxxxx / 00966xxxxxxxxx).
  if (raw.startsWith('0') && trimmedLeadingZeros) {
    add(`966${trimmedLeadingZeros}`);
    add(`00966${trimmedLeadingZeros}`);
  }

  // KSA international -> local variant.
  if (raw.startsWith('966') && raw.length > 3) {
    const local = raw.slice(3);
    const trimmedLocal = local.replace(/^0+/, '');
    add(local);
    add(trimmedLocal);
    if (trimmedLocal) add(`0${trimmedLocal}`);
  }
  if (raw.startsWith('00966') && raw.length > 5) {
    const local = raw.slice(5);
    const trimmedLocal = local.replace(/^0+/, '');
    add(local);
    add(trimmedLocal);
    if (trimmedLocal) {
      add(`0${trimmedLocal}`);
      add(`966${trimmedLocal}`);
    }
  }

  return Array.from(set);
}

export function buildDigitFuzzyPattern(variant: string): string {
  const digits = normalizePhoneDigits(variant);
  return `%${digits.split('').join('%')}%`;
}

export function phoneMatchesAnyVariant(phone: string, variants: string[]): boolean {
  const normalized = normalizePhoneDigits(phone);
  return variants.some((v) => normalized.includes(v));
}

export function bestPhoneMatchScore(phone: string, variants: string[]): number {
  const normalized = normalizePhoneDigits(phone);
  let best = 3;
  for (const variant of variants) {
    if (!variant) continue;
    if (normalized === variant) return 0;
    if (normalized.startsWith(variant)) best = Math.min(best, 1);
    else if (normalized.includes(variant)) best = Math.min(best, 2);
  }
  return best;
}
