import { NextRequest, NextResponse } from 'next/server';

import { getCheckRequests, getCheckRoster, getInventoryCheckById } from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const canViewAll = await ensureServerPermission('inventory.attendance:view:all');
    const canViewOwn = await ensureServerPermission('employee.inventory_checks:view:own');
    if (!canViewAll && !canViewOwn) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const check = await getInventoryCheckById(supabase, id);
    if (!check) {
      return NextResponse.json({ ok: false, error: 'Check not found' }, { status: 404 });
    }

    const [roster, requests] = await Promise.all([
      getCheckRoster(supabase, id),
      getCheckRequests(supabase, id)
    ]);

    return NextResponse.json({ ok: true, check, roster, requests });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load roster' },
      { status: 500 }
    );
  }
}
