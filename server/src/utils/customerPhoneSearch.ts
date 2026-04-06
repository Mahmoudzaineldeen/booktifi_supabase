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

/** Single digit sequence for deduping (+966053… vs +966532… → same key). */
export function canonicalPhoneDigitsOnly(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '';
  const trimmed = phone.trim();
  const n =
    normalizePhoneNumber(trimmed.startsWith('+') ? trimmed : `+${digits}`) || normalizePhoneNumber(digits);
  return n ? normalizePhoneDigits(n) : digits;
}

function displayPhoneFromCanonicalDigits(canonDigits: string, fallback: string): string {
  const n = normalizePhoneNumber(`+${canonDigits}`) || normalizePhoneNumber(canonDigits);
  if (n && n.startsWith('+')) return n;
  return fallback;
}

/**
 * One row per canonical number: merges customers + booking-history rows that differ only by formatting.
 * Prefers rows with `id`, then non-empty email, then longer name.
 */
export function dedupeCustomerSearchResults(
  rows: Array<{ id?: string; name: string; phone: string; email?: string | null }>
): Array<{ id?: string; name: string; phone: string; email?: string | null }> {
  const byCanon = new Map<string, Array<{ id?: string; name: string; phone: string; email?: string | null }>>();
  for (const row of rows) {
    const canon = canonicalPhoneDigitsOnly(row.phone);
    if (!canon || canon.length < 3) continue;
    if (!byCanon.has(canon)) byCanon.set(canon, []);
    byCanon.get(canon)!.push(row);
  }

  const out: Array<{ id?: string; name: string; phone: string; email?: string | null }> = [];
  for (const [canon, list] of byCanon) {
    list.sort((a, b) => {
      const sa = (a.id ? 4 : 0) + (a.email ? 2 : 0) + Math.min((a.name || '').trim().length, 40);
      const sb = (b.id ? 4 : 0) + (b.email ? 2 : 0) + Math.min((b.name || '').trim().length, 40);
      return sb - sa;
    });
    const chosen = list[0];
    const name =
      list.map((r) => (r.name || '').trim()).find((n) => n.length > 0) || chosen.name || '';
    const id = list.find((r) => r.id)?.id ?? chosen.id;
    const email = list.find((r) => r.email)?.email ?? chosen.email ?? null;
    out.push({
      id,
      name,
      email,
      phone: displayPhoneFromCanonicalDigits(canon, chosen.phone),
    });
  }
  return out;
}
