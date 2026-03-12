import { NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  try {
    const user = await getServerAuthContext();
    const supabase = createServerClient();

    const [rolesResult, assignmentsResult] = await Promise.all([
      supabase
        .from('access_roles')
        .select('role_key,role_name')
        .eq('is_active', true)
        .order('role_name', { ascending: true }),
      user?.employeeId
        ? supabase.from('employee_role_assignments').select('role_key').eq('employee_id', user.employeeId)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (rolesResult.error) {
      return NextResponse.json({ ok: false, error: rolesResult.error.message }, { status: 500 });
    }
    if (assignmentsResult.error) {
      return NextResponse.json({ ok: false, error: assignmentsResult.error.message }, { status: 500 });
    }

    const roles = ((rolesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      role_key: String(row.role_key ?? ''),
      role_name: String(row.role_name ?? row.role_key ?? '')
    }));

    const userRoleKeys = ((assignmentsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.role_key ?? '').trim())
      .filter(Boolean);

    if (userRoleKeys.length === 0 && user?.role) {
      userRoleKeys.push(String(user.role));
    }

    return NextResponse.json({
      ok: true,
      roles,
      user_role_keys: Array.from(new Set(userRoleKeys))
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load visibility context.' },
      { status: 500 }
    );
  }
}
