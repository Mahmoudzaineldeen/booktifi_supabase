import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { showNotification } from '../../contexts/NotificationContext';
import { db } from '../../lib/db';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import { parseServiceCsv, type CsvDelimiterPreset } from '../../lib/services/parseServiceCsv';
import { isAllowedCsvFile } from '../../lib/services/serviceCsvFile';
import {
  ALL_SERVICE_IMPORT_TARGET_KEYS,
  SERVICE_IMPORT_REQUIRED_KEYS,
  type ColumnMapping,
  type ServiceImportTargetKey,
  autoMapHeaders,
  rowToParsedImport,
  validateMappingComplete,
} from '../../lib/services/serviceImportMapping';
import {
  buildExampleCsv,
  buildEmptyTemplateCsv,
  downloadTextFile,
} from '../../lib/services/serviceCsvConstants';
import { createServiceWithPostSteps } from '../../lib/services/createServiceFlow';
import { Download, ChevronRight, ChevronLeft, FileSpreadsheet } from 'lucide-react';

export type ServiceImportCategory = { id: string; name: string; name_ar: string };

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  branches: Array<{ id: string; name: string; location: string | null }>;
  categories: ServiceImportCategory[];
  hideServiceSlots: boolean;
  onCompleted: () => void;
};

type Step = 1 | 2 | 3;

const DELIMITERS: { value: CsvDelimiterPreset; labelKey: string }[] = [
  { value: ',', labelKey: 'service.import.delimiterComma' },
  { value: ';', labelKey: 'service.import.delimiterSemicolon' },
  { value: '\t', labelKey: 'service.import.delimiterTab' },
  { value: '|', labelKey: 'service.import.delimiterPipe' },
];

function resolveCategoryId(
  categories: ServiceImportCategory[],
  name: string | null
): string | null {
  if (!name || !name.trim()) return null;
  const n = name.trim().toLowerCase();
  const hit = categories.find(
    (c) => c.name.trim().toLowerCase() === n || c.name_ar.trim().toLowerCase() === n
  );
  return hit?.id ?? null;
}

export function ServiceImportWizard({
  open,
  onClose,
  tenantId,
  branches,
  categories,
  hideServiceSlots,
  onCompleted,
}: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [delimiter, setDelimiter] = useState<CsvDelimiterPreset>(',');
  const [firstRowIsHeaders, setFirstRowIsHeaders] = useState(true);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importing, setImporting] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [failures, setFailures] = useState<{ rowIndex: number; message: string }[]>([]);

  // Match default new service in ServicesPage (`resetServiceForm`): slot_based even when tenant global scheduling is employee-based.
  const schedulingType: 'slot_based' | 'employee_based' = 'slot_based';

  const reset = useCallback(() => {
    setStep(1);
    setFile(null);
    setFileError(null);
    setRawText('');
    setDelimiter(',');
    setFirstRowIsHeaders(true);
    setBranchIds([]);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImporting(false);
    setCreatedCount(0);
    setFailures([]);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const previewRows = useMemo(() => rows.slice(0, 8), [rows]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setFileError(null);
    if (!f) {
      setFile(null);
      setRawText('');
      return;
    }
    if (!isAllowedCsvFile(f)) {
      setFileError(t('service.import.csvOnly'));
      setFile(null);
      setRawText('');
      return;
    }
    setFile(f);
    const text = await f.text();
    setRawText(text);
  };

  const goStep2 = () => {
    if (!file || !rawText.trim()) {
      showNotification('warning', t('service.import.chooseCsv'));
      return;
    }
    if (!branchIds.length) {
      showNotification('warning', t('service.selectAtLeastOneBranch'));
      return;
    }
    try {
      const { headers: h, rows: r } = parseServiceCsv(rawText, {
        delimiter,
        firstRowIsHeaders: firstRowIsHeaders,
      });
      if (h.length === 0 || r.length === 0) {
        showNotification('warning', t('service.import.emptyOrInvalidCsv'));
        return;
      }
      setHeaders(h);
      setRows(r);
      setMapping(autoMapHeaders(h));
      setStep(2);
    } catch (err: unknown) {
      showNotification('error', err instanceof Error ? err.message : t('service.import.parseFailed'));
    }
  };

  const goStep3 = () => {
    const err = validateMappingComplete(mapping);
    if (err) {
      showNotification('warning', t('service.import.completeRequiredMappings'));
      return;
    }
    const lineNo = (i: number) => i + (firstRowIsHeaders ? 2 : 1);
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const parsed = rowToParsedImport(headers, rows[i], mapping);
      if (!parsed.ok) {
        showNotification('warning', t('service.import.previewRowError', { row: lineNo(i), message: parsed.error }));
        return;
      }
    }
    setStep(3);
    void runImport();
  };

  const runImport = async () => {
    setImporting(true);
    setCreatedCount(0);
    setFailures([]);
    const nameSeen = new Set<string>();

    const existingRes = await db.from('services').select('name').eq('tenant_id', tenantId).then();
    if (existingRes.error) {
      setImporting(false);
      showNotification('error', (existingRes.error as { message?: string })?.message || 'Failed to load services');
      return;
    }
    for (const s of existingRes.data || []) {
      if (s?.name) nameSeen.add(String(s.name).trim().toLowerCase());
    }

    const fails: { rowIndex: number; message: string }[] = [];
    let created = 0;
    const dataRowOffset = firstRowIsHeaders ? 2 : 1;

    for (let i = 0; i < rows.length; i++) {
      const parsed = rowToParsedImport(headers, rows[i], mapping);
      if (!parsed.ok) {
        fails.push({ rowIndex: i + dataRowOffset, message: parsed.error });
        continue;
      }
      const key = parsed.row.name.trim().toLowerCase();
      if (nameSeen.has(key)) {
        fails.push({
          rowIndex: i + dataRowOffset,
          message: t('service.serviceWithSameNameExists', { name: parsed.row.name }),
        });
        continue;
      }

      const categoryId = resolveCategoryId(categories, parsed.row.categoryName);
      if (parsed.row.categoryName && !categoryId) {
        fails.push({
          rowIndex: i + dataRowOffset,
          message: t('service.import.categoryNotFound', { name: parsed.row.categoryName }),
        });
        continue;
      }

      const res = await createServiceWithPostSteps({
        db,
        apiFetch,
        getAuthHeaders,
        tenantId,
        branchIds,
        schedulingType,
        hideServiceSlots,
        row: parsed.row,
        categoryId,
      });

      if (!res.ok) {
        fails.push({ rowIndex: i + dataRowOffset, message: res.error });
        continue;
      }

      nameSeen.add(key);
      created += 1;
      setCreatedCount(created);
    }

    setFailures(fails);
    setImporting(false);
    if (created > 0) {
      showNotification('success', t('service.import.doneSummary', { created, failed: fails.length }));
      onCompleted();
    } else if (fails.length) {
      showNotification('error', t('service.import.allRowsFailed'));
    }
  };

  const setMap = (key: ServiceImportTargetKey, columnName: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (!columnName) {
        delete next[key];
      } else {
        next[key] = columnName;
      }
      return next;
    });
  };

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={t('service.import.title')}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className={step >= 1 ? 'font-semibold text-blue-700' : ''}>1. {t('service.import.stepOptions')}</span>
          <ChevronRight className="w-4 h-4" />
          <span className={step >= 2 ? 'font-semibold text-blue-700' : ''}>2. {t('service.import.stepMapping')}</span>
          <ChevronRight className="w-4 h-4" />
          <span className={step >= 3 ? 'font-semibold text-blue-700' : ''}>3. {t('service.import.stepResult')}</span>
        </div>

        {step === 1 && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <p className="text-sm text-gray-600">{t('service.import.csvOnlyHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Download className="w-4 h-4" />}
                onClick={() => downloadTextFile('services-import-example.csv', buildExampleCsv())}
              >
                {t('service.import.downloadExample')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Download className="w-4 h-4" />}
                onClick={() => downloadTextFile('services-import-template.csv', buildEmptyTemplateCsv())}
              >
                {t('service.import.downloadTemplate')}
              </Button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('service.import.fileLabel')}</label>
              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-gray-600"
                onChange={onPickFile}
              />
              {file && <p className="text-xs text-gray-500 mt-1">{file.name}</p>}
              {fileError && <p className="text-sm text-red-600 mt-1">{fileError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('service.import.delimiter')}</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as CsvDelimiterPreset)}
              >
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {t(d.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={firstRowIsHeaders}
                onChange={(e) => setFirstRowIsHeaders(e.target.checked)}
              />
              {t('service.import.firstRowIsHeaders')}
            </label>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('service.assignToBranches')}</p>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                {branches.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('service.noBranchesYet')}</p>
                ) : (
                  branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={branchIds.includes(b.id)}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setBranchIds((prev) =>
                            on ? [...prev, b.id] : prev.filter((id) => id !== b.id)
                          );
                        }}
                      />
                      <span>{b.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={goStep2} icon={<ChevronRight className="w-4 h-4" />}>
                {t('service.import.next')}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <p className="text-sm text-gray-600">{t('service.import.mappingHelp')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ALL_SERVICE_IMPORT_TARGET_KEYS.map((key) => {
                const required = SERVICE_IMPORT_REQUIRED_KEYS.includes(key);
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {key}
                      {required && ' *'}
                    </label>
                    <select
                      className="w-full border rounded-md px-2 py-1.5 text-sm"
                      value={mapping[key] ?? ''}
                      onChange={(e) => setMap(key, e.target.value)}
                    >
                      <option value="">{required ? t('service.import.selectColumn') : t('service.import.skipColumn')}</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('service.import.preview')}</p>
              <div className="overflow-x-auto border rounded-md text-xs">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-medium text-gray-700 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, ri) => (
                      <tr key={ri} className="border-t">
                        {headers.map((_, ci) => (
                          <td key={ci} className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate">
                            {r[ci] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)} icon={<ChevronLeft className="w-4 h-4" />}>
                {t('service.import.back')}
              </Button>
              <Button type="button" onClick={goStep3} icon={<ChevronRight className="w-4 h-4" />}>
                {t('service.import.importRun')}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-gray-700">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              {importing ? (
                <span>{t('service.import.running')}</span>
              ) : (
                <span>{t('service.import.resultSummary', { created: createdCount, failed: failures.length })}</span>
              )}
            </div>
            {importing && (
              <div className="animate-pulse text-sm text-gray-500">{t('service.import.pleaseWait')}</div>
            )}
            {!importing && failures.length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-700 mb-2">{t('service.import.failedRows')}</p>
                <div className="max-h-48 overflow-y-auto border rounded-md text-sm">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">{t('service.import.row')}</th>
                        <th className="text-left px-2 py-1">{t('service.import.error')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1">{f.rowIndex}</td>
                          <td className="px-2 py-1 text-red-700">{f.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleClose} disabled={importing}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
