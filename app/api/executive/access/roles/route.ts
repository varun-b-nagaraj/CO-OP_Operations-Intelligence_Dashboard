import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { createRoleTemplate, listRoleTemplates } from '@/lib/server/access-control';

export async function GET() {
  const allowed = await ensureServerPermission('executive.access_control.view');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const roles = await listRoleTemplates();
  return NextResponse.json({ ok: true, roles });
}

export async function POST(request: Request) {
  const allowed = await ensureServerPermission('executive.access_control.edit');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const payload = (await request.json()) as {
    role_key?: unknown;
    role_name?: unknown;
    description?: unknown;
    permissions?: unknown;
  };

  const roleKey = String(payload.role_key ?? '').trim();
  const roleName = String(payload.role_name ?? '').trim();
  const description = String(payload.description ?? '').trim();
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.map((value) => String(value)).filter(Boolean)
    : [];

  if (!roleKey || !roleName) {
    return NextResponse.json(
      { ok: false, error: 'role_key and role_name are required.' },
      { status: 400 }
    );
  }

  try {
    const role = await createRoleTemplate({
      role_key: roleKey,
      role_name: roleName,
      description: description || null,
      permissions
    });

    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create role.' },
      { status: 400 }
    );
  }
}
