import { NextRequest, NextResponse } from 'next/server';

import { buildFinanceReportCsv } from '@/lib/finance/export';
import { FinanceGeneratedRowSchema } from '@/lib/finance/schemas';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const canView = await ensureServerPermission('finance.reports.view');
    const canEdit = await ensureServerPermission('finance.reports.edit');
    if (!canView && !canEdit) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Missing report id.' }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get('format');
    if (format === 'csv' && !canEdit) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    const supabase = createServerClient();

    const { data: header, error: headerError } = await supabase
      .from('finance_report_headers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (headerError) {
      return NextResponse.json({ ok: false, error: headerError.message }, { status: 500 });
    }

    if (!header) {
      return NextResponse.json({ ok: false, error: 'Report not found.' }, { status: 404 });
    }

    const [rowsResult, issuesResult] = await Promise.all([
      supabase.from('finance_report_rows').select('*').eq('report_id', id).order('row_index', { ascending: true }),
      supabase
        .from('finance_report_issues')
        .select('*')
        .eq('report_id', id)
        .order('row_index', { ascending: true, nullsFirst: true })
    ]);

    if (rowsResult.error) {
      return NextResponse.json({ ok: false, error: rowsResult.error.message }, { status: 500 });
    }

    if (issuesResult.error) {
      return NextResponse.json({ ok: false, error: issuesResult.error.message }, { status: 500 });
    }

    const rows = (rowsResult.data ?? []).map((row) => {
      const parsed = FinanceGeneratedRowSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    });

    if (rows.some((row) => row === null)) {
      return NextResponse.json(
        { ok: false, error: 'Stored report rows are malformed.' },
        { status: 500 }
      );
    }

    const validRows = rows.filter((row): row is NonNullable<typeof row> => row !== null);

    if (format === 'csv') {
      const csv = buildFinanceReportCsv(validRows);

      await Promise.all([
        supabase
          .from('finance_report_headers')
          .update({ status: 'exported' })
          .eq('id', id),
        supabase.from('finance_report_activity_log').insert({
          report_id: id,
          action: 'report_exported',
          actor: 'open_access',
          details: { format: 'csv' }
        })
      ]);

      const fileNameBase = String(header.report_name ?? 'finance-report')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileNameBase || 'finance-report'}.csv"`
        }
      });
    }

    return NextResponse.json({
      ok: true,
      report: header,
      rows: validRows,
      issues: issuesResult.data ?? []
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load finance report.'
      },
      { status: 500 }
    );
  }
}
