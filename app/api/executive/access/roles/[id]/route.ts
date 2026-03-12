import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { updateRoleV2 } from '@/lib/server/access-control-v2';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const allowed = await ensureServerPermission('executive.access:manage:all');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as {
    role_name?: unknown;
    description?: unknown;
    role_priority?: unknown;
    is_active?: unknown;
    role_permissions?: unknown;
  };

  const updates: {
    role_name?: string;
    description?: string | null;
    role_priority?: number;
    is_active?: boolean;
    role_permissions?: string[];
  } = {};

  if (typeof payload.role_name === 'string') updates.role_name = payload.role_name;
  if ('description' in payload) updates.description = payload.description ? String(payload.description) : null;
  if (typeof payload.role_priority === 'number' && Number.isFinite(payload.role_priority)) {
    updates.role_priority = Math.trunc(payload.role_priority);
  }
  if (typeof payload.is_active === 'boolean') updates.is_active = payload.is_active;
  if (Array.isArray(payload.role_permissions)) {
    updates.role_permissions = payload.role_permissions.map((value) => String(value)).filter(Boolean);
  }

  try {
    const role = await updateRoleV2(id, updates);
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update role.' },
      { status: 400 }
    );
  }
}
