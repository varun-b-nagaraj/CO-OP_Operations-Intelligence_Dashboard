import { NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import { createServerClient } from '@/lib/supabase';

const DEFAULT_EMPLOYEE_PRIORITY = 100;

export async function GET() {
  const user = await getServerAuthContext();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (user.role === 'exec') {
    return NextResponse.json({
      ok: true,
      role_key: 'exec',
      role_priority: 300
    });
  }

  const supabase = createServerClient();
  const employeeId = Number(user.employeeId);

  if (Number.isFinite(employeeId) && employeeId > 0) {
    const { data } = await supabase
      .from('employee_role_assignments')
      .select('role_key,access_roles(role_priority)')
      .eq('employee_id', String(employeeId));

    let highest = DEFAULT_EMPLOYEE_PRIORITY;
    let primaryRole = String(user.role ?? 'employee_self_service');

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const roleKey = String(row.role_key ?? '').trim();
      const nested = row.access_roles as { role_priority?: number } | Array<{ role_priority?: number }> | null;
      const rolePriority =
        Array.isArray(nested) ? Number(nested[0]?.role_priority ?? DEFAULT_EMPLOYEE_PRIORITY) : Number(nested?.role_priority ?? DEFAULT_EMPLOYEE_PRIORITY);
      if (Number.isFinite(rolePriority) && rolePriority > highest) {
        highest = rolePriority;
      }
      if (roleKey && roleKey === user.role) {
        primaryRole = roleKey;
      }
    }

    return NextResponse.json({
      ok: true,
      role_key: primaryRole,
      role_priority: highest
    });
  }

  return NextResponse.json({
    ok: true,
    role_key: String(user.role ?? 'employee_self_service'),
    role_priority: DEFAULT_EMPLOYEE_PRIORITY
  });
}
