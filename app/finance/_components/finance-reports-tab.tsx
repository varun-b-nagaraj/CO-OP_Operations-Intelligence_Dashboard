'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { FinanceGeneratedRow, FinanceValidationIssue } from '@/lib/finance/types';

interface FinanceReportHeader {
  id: string;
  report_name: string;
  school_year_label: string | null;
  source_filename: string;
  source_file_path: string | null;
  uploaded_by: string;
  uploaded_at: string;
  status: string;
  report_period_start: string | null;
  report_period_end: string | null;
  total_row_count: number;
  total_collected: number;
  total_fees: number;
  total_payout: number;
  notes: string | null;
}

interface FinanceReportDetailPayload {
  report: FinanceReportHeader;
  rows: FinanceGeneratedRow[];
  issues: FinanceValidationIssue[];
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function statusBadgeClass(status: string): string {
  if (status === 'saved') return 'border-emerald-300 bg-emerald-100 text-emerald-800';
  if (status === 'processed') return 'border-blue-300 bg-blue-100 text-blue-800';
  if (status === 'failed_validation') return 'border-red-300 bg-red-100 text-red-800';
  if (status === 'exported') return 'border-indigo-300 bg-indigo-100 text-indigo-800';
  return 'border-neutral-300 bg-neutral-100 text-neutral-800';
}

async function fetchReports(filters: {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  schoolYear: string;
  uploadedBy: string;
}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.schoolYear) params.set('schoolYear', filters.schoolYear);
  if (filters.uploadedBy) params.set('uploadedBy', filters.uploadedBy);

  const response = await fetch(`/api/finance/reports?${params.toString()}`, { cache: 'no-store' });
  const payload = (await response.json()) as { ok: boolean; error?: string; reports?: FinanceReportHeader[] };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? 'Failed to fetch reports.');
  }

  return payload.reports ?? [];
}

async function fetchReportDetail(reportId: string) {
  const response = await fetch(`/api/finance/reports/${reportId}`, { cache: 'no-store' });
  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    report?: FinanceReportHeader;
    rows?: FinanceGeneratedRow[];
    issues?: FinanceValidationIssue[];
  };

  if (!response.ok || !payload.ok || !payload.report) {
    throw new Error(payload.error ?? 'Failed to load report detail.');
  }

  return {
    report: payload.report,
    rows: payload.rows ?? [],
    issues: payload.issues ?? []
  } satisfies FinanceReportDetailPayload;
}

export function FinanceReportsTab() {
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    schoolYear: '',
    uploadedBy: ''
  });
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ['finance-reports', filters],
    queryFn: () => fetchReports(filters)
  });

  const detailQuery = useQuery({
    queryKey: ['finance-report-detail', selectedReportId],
    enabled: Boolean(selectedReportId),
    queryFn: () => fetchReportDetail(String(selectedReportId))
  });

  const selectedReport = useMemo(() => {
    return reportsQuery.data?.find((report) => report.id === selectedReportId) ?? null;
  }, [reportsQuery.data, selectedReportId]);

  return (
    <section className="space-y-4 px-4 py-4 md:px-6">
      <div className="border border-neutral-300 bg-white p-3">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-6">
          <input
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))}
            placeholder="Report name"
            value={filters.search}
          />
          <select
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
            value={filters.status}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="processed">Processed</option>
            <option value="saved">Saved</option>
            <option value="exported">Exported</option>
            <option value="failed_validation">Failed Validation</option>
          </select>
          <input
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, dateFrom: event.target.value }))}
            type="date"
            value={filters.dateFrom}
          />
          <input
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, dateTo: event.target.value }))}
            type="date"
            value={filters.dateTo}
          />
          <input
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, schoolYear: event.target.value }))}
            placeholder="School year"
            value={filters.schoolYear}
          />
          <input
            className="min-h-[36px] border border-neutral-300 px-2 text-sm"
            onChange={(event) => setFilters((previous) => ({ ...previous, uploadedBy: event.target.value }))}
            placeholder="Uploaded by"
            value={filters.uploadedBy}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="border border-neutral-300 bg-white">
          <div className="border-b border-neutral-300 px-3 py-2">
            <h3 className="text-sm font-semibold text-neutral-900">Saved Reports</h3>
          </div>
          {reportsQuery.isLoading ? <p className="p-3 text-sm text-neutral-700">Loading reports...</p> : null}
          {reportsQuery.error ? (
            <p className="p-3 text-sm text-red-700">
              {reportsQuery.error instanceof Error ? reportsQuery.error.message : 'Unable to load reports.'}
            </p>
          ) : null}

          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-neutral-100">
                <tr>
                  <th className="border-b border-neutral-300 px-2 py-2">Report</th>
                  <th className="border-b border-neutral-300 px-2 py-2">Period</th>
                  <th className="border-b border-neutral-300 px-2 py-2">Status</th>
                  <th className="border-b border-neutral-300 px-2 py-2">Totals</th>
                </tr>
              </thead>
              <tbody>
                {(reportsQuery.data ?? []).map((report) => {
                  const isActive = report.id === selectedReportId;
                  return (
                    <tr
                      className={`cursor-pointer ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                      key={report.id}
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <td className="border-b border-neutral-200 px-2 py-2">
                        <p className="font-medium text-neutral-900">{report.report_name}</p>
                        <p className="text-neutral-600">{new Date(report.uploaded_at).toLocaleString()}</p>
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-2">
                        {report.report_period_start ?? '-'} to {report.report_period_end ?? '-'}
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusBadgeClass(report.status)}`}
                        >
                          {report.status}
                        </span>
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-2">
                        <p>{currency(report.total_collected)}</p>
                        <p className="text-neutral-600">{report.total_row_count} rows</p>
                      </td>
                    </tr>
                  );
                })}
                {!reportsQuery.isLoading && (reportsQuery.data?.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-sm text-neutral-700" colSpan={4}>
                      No reports match your filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="border border-neutral-300 bg-white p-3">
            <h3 className="text-sm font-semibold text-neutral-900">Report Detail</h3>
            {!selectedReportId ? (
              <p className="mt-2 text-sm text-neutral-700">Choose a report to view details.</p>
            ) : null}
            {detailQuery.isLoading ? <p className="mt-2 text-sm text-neutral-700">Loading report detail...</p> : null}
            {detailQuery.error ? (
              <p className="mt-2 text-sm text-red-700">
                {detailQuery.error instanceof Error ? detailQuery.error.message : 'Unable to load report detail.'}
              </p>
            ) : null}

            {detailQuery.data ? (
              <div className="mt-2 space-y-2 text-sm text-neutral-800">
                <p>
                  <span className="font-medium">Source CSV:</span> {detailQuery.data.report.source_filename}
                </p>
                <p>
                  <span className="font-medium">Uploaded by:</span> {detailQuery.data.report.uploaded_by}
                </p>
                <p>
                  <span className="font-medium">Rows:</span> {detailQuery.data.rows.length}
                </p>
                <p>
                  <span className="font-medium">Validation issues:</span> {detailQuery.data.issues.length}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    className="min-h-[34px] border border-neutral-700 bg-neutral-800 px-3 text-xs font-medium text-white"
                    onClick={() => {
                      window.open(`/api/finance/reports/${detailQuery.data?.report.id}?format=csv`, '_blank');
                    }}
                    type="button"
                  >
                    Download CSV
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {detailQuery.data ? (
            <div className="border border-neutral-300 bg-white">
              <div className="border-b border-neutral-300 px-3 py-2">
                <h4 className="text-sm font-semibold text-neutral-900">Generated Rows</h4>
              </div>
              <div className="max-h-[300px] overflow-auto">
                <table className="min-w-[760px] text-left text-xs">
                  <thead className="bg-neutral-100">
                    <tr>
                      <th className="border-b border-neutral-300 px-2 py-1">Sales Date</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Collected</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Fee</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Payout</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Taxed</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQuery.data.rows.map((row) => (
                      <tr key={row.row_index}>
                        <td className="border-b border-neutral-200 px-2 py-1">{row.business_sales_date}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{currency(row.collected_amount)}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{currency(row.fee_amount)}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{currency(row.payout_amount)}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{currency(row.taxed_sales_amount)}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{currency(row.sales_tax_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {detailQuery.data?.issues.length ? (
            <div className="border border-neutral-300 bg-white">
              <div className="border-b border-neutral-300 px-3 py-2">
                <h4 className="text-sm font-semibold text-neutral-900">Validation Issues</h4>
              </div>
              <div className="max-h-[220px] overflow-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-neutral-100">
                    <tr>
                      <th className="border-b border-neutral-300 px-2 py-1">Row</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Severity</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQuery.data.issues.map((issue, index) => (
                      <tr key={`${issue.row_index ?? 'global'}-${index}`}>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.row_index ?? 'Global'}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.severity}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : selectedReport ? (
            <div className="border border-neutral-300 bg-white p-3 text-sm text-emerald-700">
              No validation issues were stored for this report.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
