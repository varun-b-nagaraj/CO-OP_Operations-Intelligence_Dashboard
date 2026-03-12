import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { createRoleV2, listRolesV2 } from '@/lib/server/access-control-v2';

export async function GET() {
  const allowed = await ensureServerPermission('executive.access:view:all');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const roles = await listRolesV2();
  return NextResponse.json({ ok: true, roles });
}

export async function POST(request: Request) {
  const allowed = await ensureServerPermission('executive.access:manage:all');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const payload = (await request.json()) as {
    role_key?: unknown;
    role_name?: unknown;
    description?: unknown;
    role_permissions?: unknown;
  };

  const roleKey = String(payload.role_key ?? '').trim();
  const roleName = String(payload.role_name ?? '').trim();
  const description = String(payload.description ?? '').trim();
  const rolePermissions = Array.isArray(payload.role_permissions)
    ? payload.role_permissions.map((value) => String(value)).filter(Boolean)
    : [];

  if (!roleKey || !roleName) {
    return NextResponse.json(
      { ok: false, error: 'role_key and role_name are required.' },
      { status: 400 }
    );
  }

  try {
    const role = await createRoleV2({
      role_key: roleKey,
      role_name: roleName,
      description: description || null,
      role_permissions: rolePermissions
    });

    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create role.' },
      { status: 400 }
    );
  }
}
