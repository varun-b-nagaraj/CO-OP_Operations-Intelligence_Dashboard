import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import {
  canSelfWithdraw,
  getInventoryCheckById,
  logInventoryCheckAudit,
  upsertSignup
} from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const canSignupOwn = await ensureServerPermission('employee.inventory_checks:signup:own');
    const canEditAll = await ensureServerPermission('inventory.attendance:edit:all');
    if (!canSignupOwn && !canEditAll) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const user = await getServerAuthContext();
    const employeeId = user?.employeeId ? Number(user.employeeId) : null;
    const employeeSNumber = user?.sNumber ? String(user.sNumber).trim() : '';
    if (!employeeId || !employeeSNumber) {
      return NextResponse.json({ ok: false, error: 'Missing authenticated employee' }, { status: 401 });
    }

    const supabase = createServerClient();
    const check = await getInventoryCheckById(supabase, id);
    if (!check) return NextResponse.json({ ok: false, error: 'Check not found' }, { status: 404 });

    if (!canEditAll && !canSelfWithdraw(check)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Self-removal is locked within 24 hours. Submit a change request.'
        },
        { status: 409 }
      );
    }

    const signup = await upsertSignup(supabase, {
      inventory_check_id: id,
      employee_id: employeeId,
      employee_s_number: employeeSNumber,
      signup_status: 'withdrawn',
      actor: employeeSNumber
    });

    await logInventoryCheckAudit(supabase, {
      inventory_check_id: id,
      action: 'inventory_check_withdraw',
      actor: employeeSNumber,
      record_id: signup.id,
      new_value: signup as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, signup });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to withdraw' },
      { status: 500 }
    );
  }
}
