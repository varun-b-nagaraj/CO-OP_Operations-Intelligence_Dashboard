import { randomBytes, scryptSync } from 'crypto';

import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { updateEmployeeAccess } from '@/lib/server/access-control';
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
  const allowed = await ensureServerPermission('executive.access_control.edit');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const { employeeId } = await context.params;
  const payload = (await request.json()) as {
    role_template_id?: unknown;
    overrides?: unknown;
    password?: unknown;
  };

  const roleTemplateId =
    typeof payload.role_template_id === 'string' ? payload.role_template_id.trim() : undefined;
  const password = typeof payload.password === 'string' ? payload.password : '';

  const overrides = Array.isArray(payload.overrides)
    ? payload.overrides
        .map((entry) => {
          const value = entry as Record<string, unknown>;
          const permissionKey = String(value.permission_key ?? '').trim();
          const effect = String(value.effect ?? '') === 'deny' ? 'deny' : 'allow';
          return permissionKey
            ? {
                permission_key: permissionKey,
                effect: effect as 'allow' | 'deny'
              }
            : null;
        })
        .filter((entry): entry is { permission_key: string; effect: 'allow' | 'deny' } => Boolean(entry))
    : undefined;

  try {
    await updateEmployeeAccess({
      employeeId,
      roleTemplateId,
      overrides,
      assignedBy: 'executive_access_control'
    });

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
