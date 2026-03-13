import { NextRequest, NextResponse } from 'next/server';

import {
  createHourRequest,
  listHourRequestsForEmployee,
  logHourAudit,
  resolveHoursActor
} from '@/lib/server/hours-requests';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET() {
  try {
    const allowed =
      (await ensureServerPermission('employee.hours:submit:own')) ||
      (await ensureServerPermission('employee.requests:submit:own'));
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const actor = await resolveHoursActor();
    if (!actor) {
      return NextResponse.json({ ok: false, error: 'Missing authenticated employee' }, { status: 401 });
    }

    const supabase = createServerClient();
    const rows = await listHourRequestsForEmployee(supabase, actor.employeeId);
    return NextResponse.json({ ok: true, requests: rows });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load hour requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const allowed =
      (await ensureServerPermission('employee.hours:submit:own')) ||
      (await ensureServerPermission('employee.requests:submit:own'));
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const actor = await resolveHoursActor();
    if (!actor) {
      return NextResponse.json({ ok: false, error: 'Missing authenticated employee' }, { status: 401 });
    }

    const body = (await request.json()) as {
      hours_date?: string;
      project_name?: string;
      commitment_name?: string;
      description?: string;
      submitted_hours?: number;
    };

    const hoursDate = String(body.hours_date ?? '').trim();
    const projectName = String(body.project_name ?? '').trim();
    const commitmentName = String(body.commitment_name ?? '').trim();
    const description = String(body.description ?? '').trim();
    const submittedHours = Number(body.submitted_hours);

    if (!isValidDateOnly(hoursDate)) {
      return NextResponse.json({ ok: false, error: 'hours_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!projectName) {
      return NextResponse.json({ ok: false, error: 'project_name is required' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ ok: false, error: 'description is required' }, { status: 400 });
    }
    if (!Number.isFinite(submittedHours) || submittedHours <= 0 || submittedHours > 24) {
      return NextResponse.json({ ok: false, error: 'submitted_hours must be between 0 and 24' }, { status: 400 });
    }

    const supabase = createServerClient();
    const row = await createHourRequest(supabase, {
      employee_id: actor.employeeId,
      employee_s_number: actor.employeeSNumber,
      hours_date: hoursDate,
      project_name: projectName,
      commitment_name: commitmentName || null,
      description,
      submitted_hours: submittedHours
    });

    await logHourAudit(supabase, {
      actor: actor.employeeSNumber,
      action: 'employee_hours_submitted',
      recordId: row.id,
      newValue: row as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, request: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to submit hour request' },
      { status: 500 }
    );
  }
}
