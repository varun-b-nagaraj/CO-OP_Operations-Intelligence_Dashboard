import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import { logInventoryCheckAudit, setAttendance, upsertSignup } from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { InventoryCheckAttendanceStatus } from '@/lib/types';
import { createServerClient } from '@/lib/supabase';

const ATTENDANCE_STATUSES: InventoryCheckAttendanceStatus[] = ['expected', 'present', 'absent', 'excused'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const canEdit = await ensureServerPermission('inventory.attendance:edit:all');
    const canOverride = await ensureServerPermission('inventory.attendance:override:all');
    if (!canEdit && !canOverride) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });

    const body = (await request.json()) as {
      action?: 'set_attendance' | 'add_employee' | 'remove_employee';
      employee_id?: number;
      employee_s_number?: string;
      attendance_status?: InventoryCheckAttendanceStatus;
      attendance_reason?: string;
    };

    const action = body.action ?? 'set_attendance';
    const employeeId = Number(body.employee_id);
    const employeeSNumber = String(body.employee_s_number ?? '').trim();
    if (!Number.isFinite(employeeId) || !employeeSNumber) {
      return NextResponse.json({ ok: false, error: 'employee_id and employee_s_number are required' }, { status: 400 });
    }

    const actor = (await getServerAuthContext())?.sNumber ?? 'open_access';
    const supabase = createServerClient();

    if (action === 'add_employee') {
      const row = await upsertSignup(supabase, {
        inventory_check_id: id,
        employee_id: employeeId,
        employee_s_number: employeeSNumber,
        signup_status: 'signed_up',
        actor
      });
      await logInventoryCheckAudit(supabase, {
        inventory_check_id: id,
        action: 'inventory_check_roster_add',
        actor,
        record_id: row.id,
        new_value: row as unknown as Record<string, unknown>
      });
      return NextResponse.json({ ok: true, signup: row });
    }

    if (action === 'remove_employee') {
      const row = await upsertSignup(supabase, {
        inventory_check_id: id,
        employee_id: employeeId,
        employee_s_number: employeeSNumber,
        signup_status: 'withdrawn',
        actor
      });
      await logInventoryCheckAudit(supabase, {
        inventory_check_id: id,
        action: 'inventory_check_roster_remove',
        actor,
        record_id: row.id,
        new_value: row as unknown as Record<string, unknown>
      });
      return NextResponse.json({ ok: true, signup: row });
    }

    const status = String(body.attendance_status ?? '') as InventoryCheckAttendanceStatus;
    if (!ATTENDANCE_STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid attendance_status' }, { status: 400 });
    }

    const row = await setAttendance(supabase, {
      inventory_check_id: id,
      employee_id: employeeId,
      employee_s_number: employeeSNumber,
      attendance_status: status,
      attendance_reason: body.attendance_reason?.trim() || null,
      actor
    });

    await logInventoryCheckAudit(supabase, {
      inventory_check_id: id,
      action: 'inventory_check_attendance_set',
      actor,
      record_id: row.id,
      new_value: row as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, signup: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update attendance' },
      { status: 500 }
    );
  }
}
