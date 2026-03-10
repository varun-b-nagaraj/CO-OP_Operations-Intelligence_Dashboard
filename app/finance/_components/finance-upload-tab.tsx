'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Select } from '@/app/_components/ui/select';
import {
  FinanceColumnKey,
  FinanceColumnMapping,
  FinanceUploadPreview
} from '@/lib/finance/types';

const UploadFormSchema = z.object({
  reportName: z.string().trim().min(1, 'Report name is required').max(200),
  schoolYearLabel: z.string().trim().max(40).optional(),
  uploadedBy: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional()
});

type UploadFormValues = z.infer<typeof UploadFormSchema>;

const MAPPABLE_FIELDS: Array<{ key: FinanceColumnKey; label: string; required?: boolean }> = [
  { key: 'business_sales_date', label: 'Business Sales Date', required: true },
  { key: 'payout_date', label: 'Payout Date' },
  { key: 'collected_amount', label: 'Collected Amount', required: true },
  { key: 'fee_amount', label: 'Fee Amount', required: true },
  { key: 'payout_amount', label: 'Payout Amount' },
  { key: 'taxed_sales_amount', label: 'Taxed Sales Amount' },
  { key: 'sales_tax_amount', label: 'Sales Tax Amount' },
  { key: 'non_taxed_sales_amount', label: 'Non-Taxed Sales Amount' },
  { key: 'ach_bank_date', label: 'ACH Bank Date' },
  { key: 'gcr_gni', label: 'GCR/GNI' }
];

async function parseUploadPreview(file: File, columnMapping: FinanceColumnMapping) {
  const formData = new FormData();
  formData.append('file', file);
  if (Object.keys(columnMapping).length) {
    formData.append('columnMapping', JSON.stringify(columnMapping));
  }

  const response = await fetch('/api/finance/upload', {
    method: 'POST',
    body: formData
  });

  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    preview?: FinanceUploadPreview;
  };

  if (!response.ok || !payload.ok || !payload.preview) {
    throw new Error(payload.error ?? 'Failed to generate report preview.');
  }

  return payload.preview;
}

async function saveReport(input: {
  values: UploadFormValues;
  sourceFileName: string;
  sourceCsvText: string;
  preview: FinanceUploadPreview;
}) {
  const response = await fetch('/api/finance/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportName: input.values.reportName,
      schoolYearLabel: input.values.schoolYearLabel || undefined,
      uploadedBy: input.values.uploadedBy || undefined,
      notes: input.values.notes || undefined,
      sourceFileName: input.sourceFileName,
      sourceCsvText: input.sourceCsvText,
      rows: input.preview.rows,
      issues: input.preview.issues,
      status: input.preview.reportStatus,
      appliedMapping: input.preview.appliedMapping
    })
  });

  const payload = (await response.json()) as { ok: boolean; error?: string; reportId?: string };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? 'Failed to save report.');
  }

  return payload;
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function statusBadgeClass(status: FinanceUploadPreview['reportStatus']): string {
  if (status === 'processed') return 'border-emerald-300 bg-emerald-100 text-emerald-800';
  if (status === 'failed_validation') return 'border-red-300 bg-red-100 text-red-800';
  return 'border-neutral-300 bg-neutral-100 text-neutral-800';
}

export function FinanceUploadTab() {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceCsvText, setSourceCsvText] = useState('');
  const [preview, setPreview] = useState<FinanceUploadPreview | null>(null);
  const [mapping, setMapping] = useState<FinanceColumnMapping>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(UploadFormSchema),
    defaultValues: {
      reportName: `Finance Report ${new Date().toISOString().slice(0, 10)}`,
      schoolYearLabel: '',
      uploadedBy: 'open_access',
      notes: ''
    }
  });

  const generateMutation = useMutation({
    mutationFn: async (requestedMapping: FinanceColumnMapping) => {
      if (!selectedFile) {
        throw new Error('Choose a CSV file first.');
      }
      return parseUploadPreview(selectedFile, requestedMapping);
    },
    onSuccess: (nextPreview) => {
      setPreview(nextPreview);
      setMapping(nextPreview.appliedMapping);
      const errorCount = nextPreview.issues.filter((issue) => issue.severity === 'error').length;
      setStatusMessage(
        errorCount > 0
          ? `Preview generated with ${errorCount} validation error(s).`
          : 'Preview generated and ready to save.'
      );
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to process file.');
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (values: UploadFormValues) => {
      if (!preview || !selectedFile || !sourceCsvText) {
        throw new Error('Generate a preview first.');
      }
      return saveReport({
        values,
        sourceFileName: selectedFile.name,
        sourceCsvText,
        preview
      });
    },
    onSuccess: () => {
      setStatusMessage('Finance report saved successfully.');
      queryClient.invalidateQueries({ queryKey: ['finance-reports'] });
      setPreview(null);
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to save report.');
    }
  });

  const issueSummary = useMemo(() => {
    if (!preview) return { errors: 0, warnings: 0 };
    return {
      errors: preview.issues.filter((issue) => issue.severity === 'error').length,
      warnings: preview.issues.filter((issue) => issue.severity === 'warning').length
    };
  }, [preview]);

  return (
    <section className="space-y-4 px-4 py-4 md:px-6">
      <form
        className="space-y-4 border border-neutral-300 bg-white p-4"
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-neutral-800">
            Report Name
            <input
              className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
              {...form.register('reportName')}
            />
          </label>
          <label className="text-sm text-neutral-800">
            School/Fiscal Year
            <input
              className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
              placeholder="2025-2026"
              {...form.register('schoolYearLabel')}
            />
          </label>
          <label className="text-sm text-neutral-800">
            Uploaded By
            <input
              className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
              {...form.register('uploadedBy')}
            />
          </label>
          <label className="text-sm text-neutral-800">
            CSV File
            <input
              accept=".csv,text/csv"
              className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2 py-1"
              onChange={async (event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                setPreview(null);
                setMapping({});
                setStatusMessage(null);
                if (file) {
                  const text = await file.text();
                  setSourceCsvText(text);
                } else {
                  setSourceCsvText('');
                }
              }}
              type="file"
            />
          </label>
        </div>

        <label className="block text-sm text-neutral-800">
          Notes
          <textarea
            className="mt-1 min-h-[82px] w-full border border-neutral-300 p-2"
            {...form.register('notes')}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white disabled:opacity-50"
            disabled={!selectedFile || generateMutation.isPending}
            onClick={() => generateMutation.mutate(mapping)}
            type="button"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate Report Preview'}
          </button>
          <button
            className="min-h-[40px] border border-neutral-700 bg-neutral-800 px-4 text-sm font-medium text-white disabled:opacity-50"
            disabled={!preview || saveMutation.isPending}
            type="submit"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Report'}
          </button>
        </div>

        {statusMessage ? <p className="text-sm text-neutral-700">{statusMessage}</p> : null}
      </form>

      {preview ? (
        <section className="space-y-4">
          <div className="border border-neutral-300 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-neutral-900">Validation + Mapping</h3>
              <span
                className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(preview.reportStatus)}`}
              >
                {preview.reportStatus}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <article className="border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs uppercase text-neutral-600">Rows Ready</p>
                <p className="text-xl font-semibold text-neutral-900">{preview.rows.length}</p>
              </article>
              <article className="border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs uppercase text-neutral-600">Errors</p>
                <p className="text-xl font-semibold text-red-700">{issueSummary.errors}</p>
              </article>
              <article className="border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs uppercase text-neutral-600">Warnings</p>
                <p className="text-xl font-semibold text-amber-700">{issueSummary.warnings}</p>
              </article>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {MAPPABLE_FIELDS.map((field) => (
                <label className="text-xs text-neutral-700" key={field.key}>
                  {field.label}
                  {field.required ? <span className="ml-1 text-red-700">*</span> : null}
                  <Select
                    className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setMapping((previous) => ({
                        ...previous,
                        [field.key]: nextValue || undefined
                      }));
                    }}
                    value={mapping[field.key] ?? ''}
                  >
                    <option value="">(Not mapped)</option>
                    {preview.availableHeaders.map((header) => (
                      <option key={`${field.key}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>

            <button
              className="mt-3 min-h-[36px] border border-neutral-700 bg-neutral-800 px-3 text-xs font-medium text-white disabled:opacity-50"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate(mapping)}
              type="button"
            >
              Re-run With Current Mapping
            </button>

            {preview.issues.length ? (
              <div className="mt-4 max-h-48 overflow-auto border border-neutral-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-neutral-100">
                    <tr>
                      <th className="border-b border-neutral-300 px-2 py-1">Row</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Severity</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Message</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.issues.map((issue, index) => (
                      <tr key={`${issue.row_index ?? 'global'}-${index}`}>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.row_index ?? 'Global'}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.severity}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.message}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.field_name ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-emerald-700">No validation issues.</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <article className="border border-neutral-300 bg-white p-3">
              <p className="text-xs uppercase text-neutral-600">Collected</p>
              <p className="text-lg font-semibold text-neutral-900">{currency(preview.totals.collected)}</p>
            </article>
            <article className="border border-neutral-300 bg-white p-3">
              <p className="text-xs uppercase text-neutral-600">Fees</p>
              <p className="text-lg font-semibold text-neutral-900">{currency(preview.totals.fee)}</p>
            </article>
            <article className="border border-neutral-300 bg-white p-3">
              <p className="text-xs uppercase text-neutral-600">Payout</p>
              <p className="text-lg font-semibold text-neutral-900">{currency(preview.totals.payout)}</p>
            </article>
            <article className="border border-neutral-300 bg-white p-3">
              <p className="text-xs uppercase text-neutral-600">Report Rows</p>
              <p className="text-lg font-semibold text-neutral-900">{preview.totals.rowCount}</p>
            </article>
          </div>

          <div className="border border-neutral-300 bg-white">
            <div className="border-b border-neutral-300 px-3 py-2">
              <h3 className="text-sm font-semibold text-neutral-900">Generated Report Preview</h3>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-[1450px] text-left text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 px-2 py-2">Sales Date</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Payout Date</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Collected</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Fee</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Payout</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Credit Taxed</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Credit Tax</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Credit Non-Taxed</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Debit Fee</th>
                    <th className="border-b border-neutral-300 px-2 py-2">Debit Cash</th>
                    <th className="border-b border-neutral-300 px-2 py-2">ACH Bank Date</th>
                    <th className="border-b border-neutral-300 px-2 py-2">GCR/GNI</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row_index}>
                      <td className="border-b border-neutral-200 px-2 py-1">{row.business_sales_date}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{row.payout_date ?? '-'}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.collected_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.fee_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.payout_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.taxed_sales_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.sales_tax_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.non_taxed_sales_amount)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.lightspeed_fee_debit)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{currency(row.cash_account_debit)}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{row.ach_bank_date ?? '-'}</td>
                      <td className="border-b border-neutral-200 px-2 py-1">{row.gcr_gni ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
