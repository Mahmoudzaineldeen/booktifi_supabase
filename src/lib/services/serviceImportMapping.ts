export type ServiceImportTargetKey =
  | 'name'
  | 'name_ar'
  | 'duration_minutes'
  | 'base_price'
  | 'description'
  | 'description_ar'
  | 'category'
  | 'original_price'
  | 'discount_percentage'
  | 'service_capacity_per_slot'
  | 'is_public'
  | 'is_active';

export const SERVICE_IMPORT_REQUIRED_KEYS: ServiceImportTargetKey[] = [
  'name',
  'name_ar',
  'duration_minutes',
  'base_price',
];

export const SERVICE_IMPORT_OPTIONAL_KEYS: ServiceImportTargetKey[] = [
  'description',
  'description_ar',
  'category',
  'original_price',
  'discount_percentage',
  'service_capacity_per_slot',
  'is_public',
  'is_active',
];

export const ALL_SERVICE_IMPORT_TARGET_KEYS: ServiceImportTargetKey[] = [
  ...SERVICE_IMPORT_REQUIRED_KEYS,
  ...SERVICE_IMPORT_OPTIONAL_KEYS,
];

/** CSV column name -> target field, or null = skip */
export type ColumnMapping = Partial<Record<ServiceImportTargetKey, string | null>>;

const HEADER_ALIASES: Partial<Record<ServiceImportTargetKey, string[]>> = {
  name: ['name', 'name_en', 'service_name', 'title'],
  name_ar: ['name_ar', 'name arabic', 'arabic_name'],
  duration_minutes: ['duration_minutes', 'duration', 'minutes', 'service_duration_minutes'],
  base_price: ['base_price', 'price', 'cost'],
  description: ['description', 'description_en', 'desc'],
  description_ar: ['description_ar', 'description_arabic'],
  category: ['category', 'category_name', 'service_category'],
  original_price: ['original_price', 'list_price'],
  discount_percentage: ['discount_percentage', 'discount', 'discount_percent'],
  service_capacity_per_slot: ['service_capacity_per_slot', 'capacity', 'capacity_per_slot'],
  is_public: ['is_public', 'public'],
  is_active: ['is_active', 'active'],
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

export function autoMapHeaders(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();

  const tryMatch = (key: ServiceImportTargetKey) => {
    const aliases = [key, ...(HEADER_ALIASES[key] || [])].map(norm);
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!h || used.has(h)) continue;
      if (aliases.includes(norm(h))) {
        mapping[key] = h;
        used.add(h);
        return;
      }
    }
  };

  for (const key of ALL_SERVICE_IMPORT_TARGET_KEYS) {
    tryMatch(key);
  }

  return mapping;
}

export function mappingUsesColumn(mapping: ColumnMapping, header: string): boolean {
  return Object.values(mapping).some((v) => v === header);
}

export function validateMappingComplete(mapping: ColumnMapping): string | null {
  for (const key of SERVICE_IMPORT_REQUIRED_KEYS) {
    const col = mapping[key];
    if (!col || !String(col).trim()) {
      return `Missing required mapping: ${key}`;
    }
  }
  return null;
}

export type ParsedImportRow = {
  name: string;
  name_ar: string;
  duration_minutes: number;
  base_price: number;
  description: string | null;
  description_ar: string | null;
  categoryName: string | null;
  original_price: number | null;
  discount_percentage: number | null;
  service_capacity_per_slot: number | null;
  is_public: boolean;
  is_active: boolean;
};

function parseBool(v: string | undefined, defaultVal: boolean): boolean {
  if (v == null || String(v).trim() === '') return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return defaultVal;
}

function parseOptionalNumber(v: string | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
}

function parseRequiredNumber(v: string | undefined, field: string): { ok: true; value: number } | { ok: false; error: string } {
  if (v == null || String(v).trim() === '') {
    return { ok: false, error: `${field} is empty` };
  }
  const n = parseFloat(String(v).replace(/,/g, '.'));
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${field} is not a valid number` };
  }
  return { ok: true, value: n };
}

function parseRequiredInt(v: string | undefined, field: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = parseRequiredNumber(v, field);
  if (!n.ok) return n;
  const i = Math.round(n.value);
  if (i <= 0) return { ok: false, error: `${field} must be a positive integer` };
  return { ok: true, value: i };
}

/**
 * Apply column mapping to one CSV row (values aligned with `headers` order).
 */
export function rowToParsedImport(
  headers: string[],
  cells: string[],
  mapping: ColumnMapping
): { ok: true; row: ParsedImportRow } | { ok: false; error: string } {
  const idx = (colName: string | null | undefined) => {
    if (!colName) return -1;
    return headers.indexOf(colName);
  };

  const cell = (key: ServiceImportTargetKey) => {
    const col = mapping[key];
    const i = idx(col ?? null);
    if (i < 0) return '';
    return cells[i] ?? '';
  };

  const name = cell('name').trim();
  const name_ar = cell('name_ar').trim();
  if (!name) return { ok: false, error: 'name is empty' };
  if (!name_ar) return { ok: false, error: 'name_ar is empty' };

  const dur = parseRequiredInt(cell('duration_minutes'), 'duration_minutes');
  if (!dur.ok) return dur;

  const price = parseRequiredNumber(cell('base_price'), 'base_price');
  if (!price.ok) return price;
  if (price.value < 0) return { ok: false, error: 'base_price must be >= 0' };

  const orig = parseOptionalNumber(cell('original_price'));
  const discRaw = cell('discount_percentage').trim();
  let disc: number | null = null;
  if (discRaw) {
    const d = parseInt(discRaw, 10);
    if (!Number.isFinite(d) || d < 0) {
      return { ok: false, error: 'discount_percentage invalid' };
    }
    disc = d;
  }

  const capRaw = cell('service_capacity_per_slot').trim();
  let cap: number | null = null;
  if (capRaw) {
    const c = parseInt(capRaw, 10);
    if (!Number.isFinite(c) || c <= 0) {
      return { ok: false, error: 'service_capacity_per_slot invalid' };
    }
    cap = c;
  }

  const cat = cell('category').trim();

  return {
    ok: true,
    row: {
      name,
      name_ar,
      duration_minutes: dur.value,
      base_price: price.value,
      description: cell('description').trim() || null,
      description_ar: cell('description_ar').trim() || null,
      categoryName: cat || null,
      original_price: orig,
      discount_percentage: disc,
      service_capacity_per_slot: cap,
      is_public: parseBool(cell('is_public'), true),
      is_active: parseBool(cell('is_active'), true),
    },
  };
}
