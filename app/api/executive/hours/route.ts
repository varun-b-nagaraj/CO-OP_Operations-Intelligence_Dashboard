import { NextRequest, NextResponse } from 'next/server';

import { listHourRequestsForExecutive } from '@/lib/server/hours-requests';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

type HourRequestStatusFilter = 'all' | 'pending' | 'approved' | 'denied';

export async function GET(request: NextRequest) {
  try {
    const allowed =
      (await ensureServerPermission('executive.hours:view:all')) ||
      (await ensureServerPermission('executive.overview:view:all'));
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const statusParam = String(request.nextUrl.searchParams.get('status') ?? 'all').trim().toLowerCase();
    const status =
      statusParam === 'pending' || statusParam === 'approved' || statusParam === 'denied'
        ? statusParam
        : 'all';

    const from = String(request.nextUrl.searchParams.get('from') ?? '').trim();
    const to = String(request.nextUrl.searchParams.get('to') ?? '').trim();
    const employeeSNumber = String(request.nextUrl.searchParams.get('employee') ?? '').trim();
    const project = String(request.nextUrl.searchParams.get('project') ?? '').trim();

    const supabase = createServerClient();
    const rows = await listHourRequestsForExecutive(supabase, {
      status: status as HourRequestStatusFilter,
      from: from || undefined,
      to: to || undefined,
      employeeSNumber: employeeSNumber || undefined,
      project: project || undefined
    });

    const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id).filter((value) => Number.isFinite(value))));
    const { data: studentRows } =
      employeeIds.length > 0
        ? await supabase.from('students').select('id,name,s_number').in('id', employeeIds)
        : { data: [] as Array<{ id: number; name: string; s_number: string }> };

    const studentById = new Map<number, { name: string; sNumber: string }>();
    for (const student of studentRows ?? []) {
      studentById.set(Number(student.id), {
        name: String(student.name ?? ''),
        sNumber: String(student.s_number ?? '')
      });
    }

    const enriched = rows.map((row) => ({
      ...row,
      employee_name: studentById.get(row.employee_id)?.name ?? row.employee_s_number,
      employee_s_number: studentById.get(row.employee_id)?.sNumber ?? row.employee_s_number
    }));

    const pendingCount = rows.filter((row) => row.status === 'pending').length;
    const approvedHoursTotal = rows
      .filter((row) => row.status === 'approved')
      .reduce((sum, row) => sum + (Number.isFinite(row.approved_hours ?? NaN) ? Number(row.approved_hours) : row.submitted_hours), 0);

    const byProject = new Map<string, number>();
    const byEmployee = new Map<string, number>();
    for (const row of rows) {
      const hours = row.status === 'approved' ? Number(row.approved_hours ?? row.submitted_hours) : row.submitted_hours;
      byProject.set(row.project_name, (byProject.get(row.project_name) ?? 0) + hours);
      byEmployee.set(row.employee_s_number, (byEmployee.get(row.employee_s_number) ?? 0) + hours);
    }

    return NextResponse.json({
      ok: true,
      requests: enriched,
      analytics: {
        pending_count: pendingCount,
        approved_hours_total: Number(approvedHoursTotal.toFixed(2)),
        project_totals: Array.from(byProject.entries())
          .map(([project_name, hours]) => ({ project_name, hours: Number(hours.toFixed(2)) }))
          .sort((a, b) => b.hours - a.hours)
          .slice(0, 10),
        employee_totals: Array.from(byEmployee.entries())
          .map(([employee_s_number, hours]) => ({ employee_s_number, hours: Number(hours.toFixed(2)) }))
          .sort((a, b) => b.hours - a.hours)
          .slice(0, 10)
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load hour requests' },
      { status: 500 }
    );
  }
}
