import { NextRequest, NextResponse } from 'next/server';

import {
  createChangeRequest,
  getInventoryCheckById,
  logInventoryCheckAudit
} from '@/lib/server/inventory-checks';
import { resolveInventoryActor } from '@/lib/server/inventory-auth';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const canRequestOwn = await ensureServerPermission('employee.inventory_checks:request_change:own');
    const canEmployeeCalendar = await ensureServerPermission('employee.calendar:view:own');
    const canEditAll = await ensureServerPermission('inventory.attendance:edit:all');
    if (!canRequestOwn && !canEditAll && !canEmployeeCalendar) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });

    const body = (await request.json()) as {
      request_type?: 'add' | 'drop';
      reason?: string;
    };

    const requestType = body.request_type;
    const reason = String(body.reason ?? '').trim();
    if ((requestType !== 'add' && requestType !== 'drop') || !reason) {
      return NextResponse.json({ ok: false, error: 'request_type and reason are required' }, { status: 400 });
    }

    const actor = await resolveInventoryActor();
    if (!actor) {
      return NextResponse.json({ ok: false, error: 'Missing authenticated employee' }, { status: 401 });
    }

    const supabase = createServerClient();
    const check = await getInventoryCheckById(supabase, id);
    if (!check) return NextResponse.json({ ok: false, error: 'Check not found' }, { status: 404 });

    const row = await createChangeRequest(supabase, {
      inventory_check_id: id,
      employee_id: actor.employeeId,
      employee_s_number: actor.employeeSNumber,
      request_type: requestType,
      reason
    });

    await logInventoryCheckAudit(supabase, {
      inventory_check_id: id,
      action: 'inventory_check_change_request_submitted',
      actor: actor.employeeSNumber,
      record_id: row.id,
      new_value: row as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, request: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to submit request' },
      { status: 500 }
    );
  }
}
