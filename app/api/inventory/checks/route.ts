import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import {
  canSelfWithdraw,
  createInventoryCheck,
  getCheckRoster,
  getCheckRequests,
  listInventoryChecks
} from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const canViewAll = await ensureServerPermission('inventory.attendance:view:all');
    const canViewOwn = await ensureServerPermission('employee.inventory_checks:view:own');
    if (!canViewAll && !canViewOwn) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const from = request.nextUrl.searchParams.get('from') ?? undefined;
    const to = request.nextUrl.searchParams.get('to') ?? undefined;
    const includeRoster = request.nextUrl.searchParams.get('includeRoster') === '1';
    const includeRequests = request.nextUrl.searchParams.get('includeRequests') === '1';
    const mineOnly = request.nextUrl.searchParams.get('mine') === '1';

    const supabase = createServerClient();
    const checks = await listInventoryChecks(supabase, { from, to });

    let currentEmployeeId: number | null = null;
    if (mineOnly || canViewOwn) {
      const user = await getServerAuthContext();
      currentEmployeeId = user?.employeeId ? Number(user.employeeId) : null;
    }

    const payload = await Promise.all(
      checks.map(async (check) => {
        const roster = includeRoster ? await getCheckRoster(supabase, check.id) : [];
        const requests = includeRequests ? await getCheckRequests(supabase, check.id) : [];
        const ownSignup = currentEmployeeId
          ? roster.find((row) => row.employee_id === currentEmployeeId) ?? null
          : null;
        const ownRequestPending = currentEmployeeId
          ? requests.some((row) => row.employee_id === currentEmployeeId && row.status === 'pending')
          : false;
        const signupState = ownRequestPending
          ? 'requested_change'
          : ownSignup?.signup_status === 'signed_up'
            ? 'signed_up'
            : ownSignup?.signup_status === 'withdrawn'
              ? 'withdrawn'
              : 'none';
        return {
          ...check,
          can_self_withdraw: canSelfWithdraw(check),
          signup_state: signupState,
          own_signup: ownSignup,
          roster: includeRoster ? roster : undefined,
          requests: includeRequests ? requests : undefined
        };
      })
    );

    const filtered =
      mineOnly && currentEmployeeId
        ? payload.filter((check) => check.own_signup?.employee_id === currentEmployeeId)
        : payload;

    return NextResponse.json({ ok: true, checks: filtered });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to list checks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('inventory.attendance:edit:all');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      title?: string;
      details?: string;
      starts_at?: string;
      ends_at?: string | null;
      priority?: 'employee' | 'department_manager' | 'all_managers' | 'exec';
      location?: string;
      notes?: string;
      capacity?: number | null;
    };

    const title = String(body.title ?? '').trim();
    const startsAt = String(body.starts_at ?? '').trim();
    if (!title || !startsAt) {
      return NextResponse.json({ ok: false, error: 'title and starts_at are required' }, { status: 400 });
    }

    const user = await getServerAuthContext();
    const supabase = createServerClient();
    const check = await createInventoryCheck(supabase, {
      title,
      details: body.details?.trim() || null,
      starts_at: startsAt,
      ends_at: body.ends_at ?? null,
      priority: body.priority ?? 'employee',
      source_department: 'inventory',
      location: body.location?.trim() || null,
      notes: body.notes?.trim() || null,
      capacity: body.capacity ?? null,
      created_by: user?.sNumber ?? 'open_access'
    });

    return NextResponse.json({ ok: true, check });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create check' },
      { status: 500 }
    );
  }
}
