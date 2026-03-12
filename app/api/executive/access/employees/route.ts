import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { listEmployeeAccess } from '@/lib/server/access-control';

export async function GET() {
  const allowed = await ensureServerPermission('executive.access_control.view');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const employees = await listEmployeeAccess();
  return NextResponse.json({ ok: true, employees });
}
