import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { fetchExecutiveOverview } from '@/lib/server/executive';

export async function GET() {
  try {
    const allowed = await ensureServerPermission('executive.overview.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const data = await fetchExecutiveOverview();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load executive overview.'
      },
      { status: 500 }
    );
  }
}
