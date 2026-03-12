import { NextRequest, NextResponse } from 'next/server';

import { FinanceReportsQuerySchema, FinanceSaveReportSchema } from '@/lib/finance/schemas';
import { computeFinanceTotals } from '@/lib/finance/totals';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

function buildStoragePath(reportName: string, sourceFileName: string): string {
  const slug = reportName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const sanitizedFile = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `uploads/${new Date().toISOString().slice(0, 10)}/${slug || 'finance-report'}-${Date.now()}-${sanitizedFile}`;
}

export async function GET(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('finance.reports.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const rawFilters = {
      search: request.nextUrl.searchParams.get('search') ?? undefined,
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      dateFrom: request.nextUrl.searchParams.get('dateFrom') ?? undefined,
      dateTo: request.nextUrl.searchParams.get('dateTo') ?? undefined,
      schoolYear: request.nextUrl.searchParams.get('schoolYear') ?? undefined,
      uploadedBy: request.nextUrl.searchParams.get('uploadedBy') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined
    };

    const filtersResult = FinanceReportsQuerySchema.safeParse(rawFilters);
    if (!filtersResult.success) {
      return NextResponse.json({ ok: false, error: 'Invalid filters.' }, { status: 400 });
    }

    const filters = filtersResult.data;
    const supabase = createServerClient();

    let query = supabase
      .from('finance_report_headers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filters.limit ?? 100);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.schoolYear) query = query.eq('school_year_label', filters.schoolYear);
    if (filters.uploadedBy) query = query.ilike('uploaded_by', `%${filters.uploadedBy}%`);
    if (filters.search) query = query.ilike('report_name', `%${filters.search}%`);
    if (filters.dateFrom) query = query.gte('uploaded_at', `${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) query = query.lte('uploaded_at', `${filters.dateTo}T23:59:59.999Z`);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reports: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list finance reports.'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('finance.reports.edit');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = FinanceSaveReportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid report payload.' }, { status: 400 });
    }

    const payload = parsed.data;
    const supabase = createServerClient();

    const storagePath = buildStoragePath(payload.reportName, payload.sourceFileName);

    const uploadResult = await supabase.storage
      .from('finance-files')
      .upload(storagePath, payload.sourceCsvText, {
        contentType: 'text/csv',
        upsert: true
      });

    if (uploadResult.error) {
      return NextResponse.json({ ok: false, error: uploadResult.error.message }, { status: 500 });
    }

    const totals = computeFinanceTotals(payload.rows);
    const reportPeriodStart =
      payload.reportPeriodStart ?? payload.rows.map((row) => row.business_sales_date).sort()[0] ?? null;
    const reportPeriodEnd =
      payload.reportPeriodEnd ?? payload.rows.map((row) => row.business_sales_date).sort().slice(-1)[0] ?? null;

    const reportStatus = payload.status ?? (payload.issues.some((issue) => issue.severity === 'error') ? 'failed_validation' : 'saved');

    const { data: reportHeader, error: reportHeaderError } = await supabase
      .from('finance_report_headers')
      .insert({
        report_name: payload.reportName,
        school_year_label: payload.schoolYearLabel ?? null,
        source_filename: payload.sourceFileName,
        source_file_path: storagePath,
        uploaded_by: payload.uploadedBy ?? 'open_access',
        uploaded_at: new Date().toISOString(),
        status: reportStatus,
        report_period_start: reportPeriodStart,
        report_period_end: reportPeriodEnd,
        total_row_count: totals.rowCount,
        total_collected: totals.collected,
        total_fees: totals.fee,
        total_payout: totals.payout,
        notes: payload.notes ?? null,
        metadata: {
          appliedMapping: payload.appliedMapping ?? null
        }
      })
      .select('id')
      .single();

    if (reportHeaderError || !reportHeader) {
      return NextResponse.json(
        { ok: false, error: reportHeaderError?.message ?? 'Failed to create report header.' },
        { status: 500 }
      );
    }

    const rowsToInsert = payload.rows.map((row) => ({
      report_id: reportHeader.id,
      row_index: row.row_index,
      business_sales_date: row.business_sales_date,
      payout_date: row.payout_date,
      collected_amount: row.collected_amount,
      fee_amount: row.fee_amount,
      payout_amount: row.payout_amount,
      taxed_sales_amount: row.taxed_sales_amount,
      sales_tax_amount: row.sales_tax_amount,
      non_taxed_sales_amount: row.non_taxed_sales_amount,
      lightspeed_fee_debit: row.lightspeed_fee_debit,
      cash_account_debit: row.cash_account_debit,
      ach_bank_date: row.ach_bank_date,
      gcr_gni: row.gcr_gni,
      raw_source_payload: row.raw_source_payload,
      generated_payload: row.generated_payload
    }));

    if (rowsToInsert.length) {
      const { error: rowsError } = await supabase.from('finance_report_rows').insert(rowsToInsert);
      if (rowsError) {
        return NextResponse.json({ ok: false, error: rowsError.message }, { status: 500 });
      }
    }

    const issuesToInsert = payload.issues.map((issue) => ({
      report_id: reportHeader.id,
      row_index: issue.row_index,
      severity: issue.severity,
      message: issue.message,
      field_name: issue.field_name,
      raw_value: issue.raw_value
    }));

    if (issuesToInsert.length) {
      const { error: issuesError } = await supabase.from('finance_report_issues').insert(issuesToInsert);
      if (issuesError) {
        return NextResponse.json({ ok: false, error: issuesError.message }, { status: 500 });
      }
    }

    const { error: auditError } = await supabase.from('finance_report_activity_log').insert({
      report_id: reportHeader.id,
      action: 'report_created',
      actor: payload.uploadedBy ?? 'open_access',
      details: {
        source_filename: payload.sourceFileName,
        status: reportStatus,
        issue_count: payload.issues.length,
        row_count: payload.rows.length
      }
    });

    if (auditError) {
      return NextResponse.json({ ok: false, error: auditError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reportId: reportHeader.id });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to save finance report.'
      },
      { status: 500 }
    );
  }
}
