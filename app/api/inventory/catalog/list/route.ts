import { NextRequest, NextResponse } from 'next/server';

import { listCatalog } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const query = request.nextUrl.searchParams.get('q') ?? '';
    const items = await listCatalog(supabase, query);

    return NextResponse.json({ ok: true, items });
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
