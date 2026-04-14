/** UTF-8 BOM so Excel opens CSV correctly */
export const CSV_UTF8_BOM = '\uFEFF';

/** Canonical header row for template / example (English). */
export const SERVICE_CSV_CANONICAL_HEADERS = [
  'name',
  'name_ar',
  'duration_minutes',
  'base_price',
  'description',
  'description_ar',
  'category',
  'original_price',
  'discount_percentage',
  'service_capacity_per_slot',
  'is_public',
  'is_active',
] as const;

export type ServiceCsvCanonicalHeader = (typeof SERVICE_CSV_CANONICAL_HEADERS)[number];

/** Example rows (not real tenant data) for user guidance. */
export const SERVICE_CSV_EXAMPLE_ROWS: string[][] = [
  [
    'Classic haircut',
    'قص شعر كلاسيكي',
    '45',
    '80',
    'Wash and cut',
    'غسيل وقص',
    '',
    '100',
    '20',
    '2',
    'true',
    'true',
  ],
  [
    'Deep tissue massage',
    'تدليك الأنسجة العميقة',
    '90',
    '250',
    '',
    '',
    '',
    '',
    '',
    '1',
    'true',
    'true',
  ],
];

export function buildEmptyTemplateCsv(): string {
  const line = SERVICE_CSV_CANONICAL_HEADERS.join(',');
  return `${CSV_UTF8_BOM}${line}\r\n`;
}

export function buildExampleCsv(): string {
  const header = SERVICE_CSV_CANONICAL_HEADERS.join(',');
  const body = SERVICE_CSV_EXAMPLE_ROWS.map((r) => r.map(escapeCsvField).join(',')).join('\r\n');
  return `${CSV_UTF8_BOM}${header}\r\n${body}\r\n`;
}

function escapeCsvField(cell: string): string {
  const s = String(cell ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
