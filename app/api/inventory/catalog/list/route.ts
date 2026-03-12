import { NextRequest, NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { listCatalog } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('inventory.catalog:view:all');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const query = request.nextUrl.searchParams.get('q') ?? '';
    const pageRaw = Number(request.nextUrl.searchParams.get('page') ?? '1');
    const perPageRaw = Number(request.nextUrl.searchParams.get('per_page') ?? '100');
    const all = request.nextUrl.searchParams.get('all') === '1';
    const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
    const perPage = Number.isFinite(perPageRaw) ? Math.min(100, Math.max(1, perPageRaw)) : 100;

    const result = await listCatalog(supabase, query, { page, perPage, all });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to list catalog'
      },
      { status: 500 }
    );
  }
}
