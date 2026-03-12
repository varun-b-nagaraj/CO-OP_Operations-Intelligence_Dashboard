import { NextRequest, NextResponse } from 'next/server';

import { computeInventoryAnalytics } from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('inventory.attendance:view:all');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const from = request.nextUrl.searchParams.get('from') ?? undefined;
    const to = request.nextUrl.searchParams.get('to') ?? undefined;
    const supabase = createServerClient();
    const analytics = await computeInventoryAnalytics(supabase, { from, to });
    return NextResponse.json({ ok: true, analytics });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load analytics' },
      { status: 500 }
    );
  }
}
