import { NextRequest, NextResponse } from 'next/server';

import { parseInventoryCsv } from '@/lib/inventory/csv';
import { upsertCatalogItem } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const formData = await request.formData();

    const file = formData.get('file');
    const csvText = formData.get('csvText');

    let input = '';
    if (file instanceof File) {
      input = await file.text();
    } else if (typeof csvText === 'string') {
      input = csvText;
    }

    if (!input.trim()) {
      return NextResponse.json({ ok: false, error: 'CSV content is required' }, { status: 400 });
    }

    const rows = parseInventoryCsv(input);
    let inserted = 0;

    for (const row of rows) {
      // Catalog-only import: no count mutation, and Qty. is ignored by parser mapping.
      await upsertCatalogItem(supabase, row);
      inserted += 1;
    }

    return NextResponse.json({ ok: true, imported: inserted });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to import CSV'
      },
      { status: 500 }
    );
  }
}
