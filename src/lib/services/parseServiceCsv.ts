import Papa from 'papaparse';
import { stripUtf8Bom } from './serviceCsvFile';

export type CsvDelimiterPreset = ',' | '\t' | ';' | '|';

export function delimiterPresetToChar(preset: CsvDelimiterPreset): string {
  return preset;
}

export function parseServiceCsv(
  text: string,
  options: { delimiter: string; firstRowIsHeaders: boolean }
): { headers: string[]; rows: string[][] } {
  const raw = stripUtf8Bom(text.trim());
  if (!raw) {
    return { headers: [], rows: [] };
  }

  const parsed = Papa.parse<string[]>(raw, {
    delimiter: options.delimiter,
    skipEmptyLines: 'greedy',
  });

  if (parsed.errors?.length) {
    const fatal = parsed.errors.find((e) => e.type === 'Quotes' || e.code === 'TooManyFields');
    if (fatal) {
      throw new Error(fatal.message || 'Invalid CSV');
    }
  }

  const data = (parsed.data as string[][]).filter((row) =>
    row.some((c) => String(c ?? '').trim() !== '')
  );

  if (data.length === 0) {
    return { headers: [], rows: [] };
  }

  const maxCols = Math.max(...data.map((r) => r.length), 1);

  const pad = (row: string[], width: number) => {
    const out = row.map((c) => String(c ?? '').trim());
    while (out.length < width) out.push('');
    return out.slice(0, width);
  };

  if (options.firstRowIsHeaders) {
    const headers = pad(data[0], maxCols).map((h, i) => (h?.trim() ? h.trim() : `Column_${i + 1}`));
    const rows = data.slice(1).map((r) => pad(r, maxCols));
    return { headers, rows };
  }

  const width = data[0].length;
  const headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const rows = data.map((r) => pad(r, width));
  return { headers, rows };
}
