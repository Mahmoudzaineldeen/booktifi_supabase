import { normalizePhoneNumber } from './normalizePhoneNumber';

export function normalizePhoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/** Add canonical E.164 digit forms so 9660… / 9665… / 05… all match stored +9665… */
function addNormalizedDigitForms(rawDigits: string, add: (v: string) => void) {
  if (!rawDigits || rawDigits.length < 3) return;
  const tryForms = [rawDigits, `+${rawDigits}`, rawDigits.startsWith('00') ? `+${rawDigits.slice(2)}` : `+${rawDigits}`];
  for (const f of tryForms) {
    const n = normalizePhoneNumber(f);
    if (n) {
      const d = normalizePhoneDigits(n);
      if (d.length >= 3) add(d);
    }
  }
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
    // Trunk zero after 966: 9660532… ↔ 966532… (same as Egypt +20 behavior)
    if (local.startsWith('0') && local.length >= 2) {
      add(`966${local.slice(1)}`);
    }
    if (!local.startsWith('0') && local.startsWith('5') && local.length >= 2) {
      add(`9660${local}`);
    }
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

  addNormalizedDigitForms(raw, add);

  return Array.from(set);
}

export function buildDigitFuzzyPattern(variant: string): string {
  const digits = normalizePhoneDigits(variant);
  return `%${digits.split('').join('%')}%`;
}

function canonicalPhoneDigits(phone: string): string[] {
  const digits = normalizePhoneDigits(phone);
  const out = new Set<string>([digits]);
  const withPlus = phone.trim().startsWith('+') ? phone.trim() : `+${digits}`;
  const n = normalizePhoneNumber(withPlus) || normalizePhoneNumber(digits);
  if (n) out.add(normalizePhoneDigits(n));
  return Array.from(out);
}

export function phoneMatchesAnyVariant(phone: string, variants: string[]): boolean {
  const phoneForms = canonicalPhoneDigits(phone);
  return variants.some((v) => {
    if (!v) return false;
    for (const pd of phoneForms) {
      if (pd.includes(v)) return true;
    }
    return false;
  });
}

export function bestPhoneMatchScore(phone: string, variants: string[]): number {
  const phoneForms = canonicalPhoneDigits(phone);
  let best = 3;
  for (const variant of variants) {
    if (!variant) continue;
    for (const pd of phoneForms) {
      if (pd === variant) return 0;
      if (pd.startsWith(variant)) best = Math.min(best, 1);
      else if (pd.includes(variant)) best = Math.min(best, 2);
    }
  }
  return best;
}
