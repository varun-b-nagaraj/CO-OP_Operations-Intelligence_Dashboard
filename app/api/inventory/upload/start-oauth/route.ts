import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';

export async function GET() {
  try {
    const allowed = await ensureServerPermission('inventory.finalize_upload.edit');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const response = await fetch('https://inventory-upload.vercel.app/api/oauth/start', {
      method: 'GET',
      cache: 'no-store'
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: payload }, { status: response.status });
    }

    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'OAuth start failed' },
      { status: 500 }
    );
  }
}
