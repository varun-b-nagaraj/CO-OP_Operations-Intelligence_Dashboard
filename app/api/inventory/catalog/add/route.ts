import { NextRequest, NextResponse } from 'next/server';

import { CatalogUpsertInput } from '@/lib/inventory/types';
import { softDeleteCatalogItem, upsertCatalogItem } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = (await request.json()) as {
      action?: 'upsert' | 'remove';
      item?: CatalogUpsertInput;
      row_id?: number;
    };

    if (body.action === 'remove') {
      if (!body.row_id) {
        return NextResponse.json({ ok: false, error: 'row_id is required for remove' }, { status: 400 });
      }
      await softDeleteCatalogItem(supabase, body.row_id);
      return NextResponse.json({ ok: true });
    }

    const item = body.item;
    if (!item) {
      return NextResponse.json({ ok: false, error: 'item is required' }, { status: 400 });
    }

    if (!String(item.system_id ?? '').trim() || !String(item.item_name ?? '').trim()) {
      return NextResponse.json(
        { ok: false, error: 'Minimum fields: system_id and item_name' },
        { status: 400 }
      );
    }

    const saved = await upsertCatalogItem(supabase, item);
    return NextResponse.json({ ok: true, item: saved });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to upsert catalog item'
      },
      { status: 500 }
    );
  }
}
