import { describe, it, expect } from 'vitest';
import { parseServiceCsv } from '../../src/lib/services/parseServiceCsv';
import { isAllowedCsvFile } from '../../src/lib/services/serviceCsvFile';
import {
  autoMapHeaders,
  rowToParsedImport,
  validateMappingComplete,
  type ColumnMapping,
  type ParsedImportRow,
} from '../../src/lib/services/serviceImportMapping';
import { buildServiceInsertPayloadFromImportRow } from '../../src/lib/services/createServiceFlow';

describe('isAllowedCsvFile', () => {
  it('accepts .csv extension', () => {
    expect(isAllowedCsvFile(new File(['a'], 'data.csv', { type: '' }))).toBe(true);
    expect(isAllowedCsvFile(new File(['a'], 'DATA.CSV', { type: '' }))).toBe(true);
  });
  it('rejects non-csv', () => {
    expect(isAllowedCsvFile(new File(['a'], 'data.txt', { type: 'text/plain' }))).toBe(false);
    expect(isAllowedCsvFile(new File(['a'], 'sheet.csv.xlsx', { type: '' }))).toBe(false);
  });
});

describe('parseServiceCsv', () => {
  it('parses with headers and comma', () => {
    const text = 'name,price\nA,10\nB,20';
    const { headers, rows } = parseServiceCsv(text, { delimiter: ',', firstRowIsHeaders: true });
    expect(headers).toEqual(['name', 'price']);
    expect(rows).toEqual([
      ['A', '10'],
      ['B', '20'],
    ]);
  });
  it('synthesizes column labels when first row is not headers', () => {
    const text = 'x;y\n1;2';
    const { headers, rows } = parseServiceCsv(text, { delimiter: ';', firstRowIsHeaders: false });
    expect(headers).toEqual(['Column 1', 'Column 2']);
    expect(rows).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
  it('strips UTF-8 BOM', () => {
    const text = '\uFEFFa,b\n1,2';
    const { headers, rows } = parseServiceCsv(text, { delimiter: ',', firstRowIsHeaders: true });
    expect(headers[0]).toBe('a');
    expect(rows[0]).toEqual(['1', '2']);
  });
});

describe('serviceImportMapping', () => {
  it('autoMapHeaders matches canonical names', () => {
    const m = autoMapHeaders(['name', 'name_ar', 'duration_minutes', 'base_price']);
    expect(m.name).toBe('name');
    expect(m.name_ar).toBe('name_ar');
    expect(m.duration_minutes).toBe('duration_minutes');
    expect(m.base_price).toBe('base_price');
  });
  it('validateMappingComplete requires core fields', () => {
    const partial: ColumnMapping = { name: 'n', name_ar: 'ar' };
    expect(validateMappingComplete(partial)).not.toBeNull();
    const ok: ColumnMapping = {
      name: 'n',
      name_ar: 'ar',
      duration_minutes: 'd',
      base_price: 'p',
    };
    expect(validateMappingComplete(ok)).toBeNull();
  });
  it('rowToParsedImport maps cells', () => {
    const headers = ['n', 'ar', 'dur', 'pr'];
    const cells = ['Test', 'اختبار', '30', '12.5'];
    const mapping: ColumnMapping = {
      name: 'n',
      name_ar: 'ar',
      duration_minutes: 'dur',
      base_price: 'pr',
    };
    const r = rowToParsedImport(headers, cells, mapping);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.name).toBe('Test');
      expect(r.row.name_ar).toBe('اختبار');
      expect(r.row.duration_minutes).toBe(30);
      expect(r.row.base_price).toBe(12.5);
    }
  });
});

const baseRow = (): ParsedImportRow => ({
  name: 'S',
  name_ar: 'س',
  duration_minutes: 60,
  base_price: 10,
  description: null,
  description_ar: null,
  categoryName: null,
  original_price: null,
  discount_percentage: null,
  service_capacity_per_slot: 2,
  is_public: true,
  is_active: true,
});

describe('buildServiceInsertPayloadFromImportRow', () => {
  it('uses service_based + numeric service_capacity when scheduling is slot_based with hideServiceSlots', () => {
    const p = buildServiceInsertPayloadFromImportRow(baseRow(), {
      tenantId: 't1',
      schedulingType: 'slot_based',
      hideServiceSlots: true,
    });
    expect(p.capacity_mode).toBe('service_based');
    expect(p.scheduling_type).toBe('slot_based');
    expect(p.service_capacity_per_slot).toBe(1);
    expect(p.capacity_per_slot).toBe(1);
    expect(p.assignment_mode).toBeNull();
  });

  it('sets service_capacity_per_slot null when scheduling is employee_based', () => {
    const p = buildServiceInsertPayloadFromImportRow(baseRow(), {
      tenantId: 't1',
      schedulingType: 'employee_based',
      hideServiceSlots: false,
    });
    expect(p.capacity_mode).toBe('employee_based');
    expect(p.service_capacity_per_slot).toBeNull();
    expect(p.capacity_per_slot).toBe(1);
    expect(p.assignment_mode).toBe('manual_assign');
  });

  it('uses CSV capacity when slot_based and not hideServiceSlots', () => {
    const p = buildServiceInsertPayloadFromImportRow(baseRow(), {
      tenantId: 't1',
      schedulingType: 'slot_based',
      hideServiceSlots: false,
    });
    expect(p.capacity_mode).toBe('service_based');
    expect(p.service_capacity_per_slot).toBe(2);
    expect(p.capacity_per_slot).toBe(2);
  });
});
