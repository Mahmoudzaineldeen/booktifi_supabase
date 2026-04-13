import enTranslations from '../locales/en.json';

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

function flattenMessages(
  value: unknown,
  parentKey = '',
  output: Record<string, string> = {}
): Record<string, string> {
  if (typeof value === 'string') {
    output[parentKey] = value;
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return output;
  }

  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    const fullKey = parentKey ? `${parentKey}.${childKey}` : childKey;
    flattenMessages(childValue, fullKey, output);
  }
  return output;
}

function normalizeMessage(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function looksLikeTranslationKey(value: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value);
}

const EN_MESSAGE_TO_KEY = (() => {
  const flattened = flattenMessages(enTranslations);
  const map = new Map<string, string>();

  for (const [key, message] of Object.entries(flattened)) {
    const normalized = normalizeMessage(message);
    if (!map.has(normalized)) {
      map.set(normalized, key);
    }
  }

  return map;
})();

function translateIfKeyExists(t: TranslationFn, key: string): string | null {
  const translated = t(key);
  if (!translated || translated === key) return null;
  return translated;
}

export function localizeUiMessage(message: string, t: TranslationFn): string {
  if (!message) return '';

  const trimmed = message.trim();
  if (!trimmed) return message;

  const directTranslation = translateIfKeyExists(t, trimmed);
  if (directTranslation) return directTranslation;

  const mappedKey = EN_MESSAGE_TO_KEY.get(normalizeMessage(trimmed));
  if (mappedKey) {
    const mappedTranslation = translateIfKeyExists(t, mappedKey);
    if (mappedTranslation) return mappedTranslation;
  }

  if (!looksLikeTranslationKey(trimmed) && /^error\s*:/i.test(trimmed)) {
    const details = trimmed.replace(/^error\s*:/i, '').trim();
    const errorLabel = translateIfKeyExists(t, 'common.error') || 'Error';
    return details ? `${errorLabel}: ${details}` : errorLabel;
  }

  return message;
}
