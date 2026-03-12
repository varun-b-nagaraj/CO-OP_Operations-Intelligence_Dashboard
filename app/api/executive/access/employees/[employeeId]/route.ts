import { randomBytes, scryptSync } from 'crypto';

import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { updateEmployeeRoleAssignmentsV2 } from '@/lib/server/access-control-v2';
import { createServerClient } from '@/lib/supabase';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ employeeId: string }> }
) {
  const allowed = await ensureServerPermission('executive.access:manage:all');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const { employeeId } = await context.params;
  const payload = (await request.json()) as {
    primary_role_key?: unknown;
    secondary_role_keys?: unknown;
    password?: unknown;
  };

  const primaryRoleKey =
    typeof payload.primary_role_key === 'string' ? payload.primary_role_key.trim() : '';
  const secondaryRoleKeys = Array.isArray(payload.secondary_role_keys)
    ? payload.secondary_role_keys.map((entry) => String(entry)).filter(Boolean)
    : [];
  const password = typeof payload.password === 'string' ? payload.password : '';

  try {
    if (primaryRoleKey) {
      await updateEmployeeRoleAssignmentsV2({
        employee_id: employeeId,
        primary_role_key: primaryRoleKey,
        secondary_role_keys: secondaryRoleKeys
      });
    }

    if (password.trim()) {
      if (password.length < 8) {
        return NextResponse.json(
          { ok: false, error: 'Password must be at least 8 characters.' },
          { status: 400 }
        );
      }

      const supabase = createServerClient();
      const { error: passwordError } = await supabase
        .from('employee_login_credentials')
        .upsert(
          {
            employee_id: employeeId,
            password_hash: hashPassword(password),
            password_updated_at: new Date().toISOString()
          },
          { onConflict: 'employee_id' }
        );

      if (passwordError) {
        return NextResponse.json(
          { ok: false, error: passwordError.message },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update employee access.' },
      { status: 400 }
    );
  }
}
