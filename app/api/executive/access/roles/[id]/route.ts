import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { updateRoleTemplate } from '@/lib/server/access-control';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const allowed = await ensureServerPermission('executive.access_control.edit');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as {
    role_name?: unknown;
    description?: unknown;
    is_active?: unknown;
    permissions?: unknown;
  };

  const updates: {
    role_name?: string;
    description?: string | null;
    is_active?: boolean;
    permissions?: string[];
  } = {};

  if (typeof payload.role_name === 'string') updates.role_name = payload.role_name;
  if ('description' in payload) updates.description = payload.description ? String(payload.description) : null;
  if (typeof payload.is_active === 'boolean') updates.is_active = payload.is_active;
  if (Array.isArray(payload.permissions)) {
    updates.permissions = payload.permissions.map((value) => String(value)).filter(Boolean);
  }

  try {
    const role = await updateRoleTemplate(id, updates);
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to update role.' },
      { status: 400 }
    );
  }
}
