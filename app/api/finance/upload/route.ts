import { NextRequest, NextResponse } from 'next/server';

import { parseCsv } from '@/lib/finance/csv';
import { loadFinanceTransformationConfig } from '@/lib/finance/config';
import { FinanceColumnMappingSchema } from '@/lib/finance/schemas';
import { transformFinanceRows } from '@/lib/finance/transform';
import { createServerClient } from '@/lib/supabase';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const mappingRaw = formData.get('columnMapping');

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'CSV file is required.' }, { status: 400 });
    }

    const isCsvFile = file.type.includes('csv') || file.name.toLowerCase().endsWith('.csv');
    if (!isCsvFile) {
      return NextResponse.json({ ok: false, error: 'Only CSV files are supported.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'File is too large. Max size is 5MB.' },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    if (!csvText.trim()) {
      return NextResponse.json({ ok: false, error: 'CSV file is empty.' }, { status: 400 });
    }

    const parsed = parseCsv(csvText);
    if (!parsed.headers.length) {
      return NextResponse.json({ ok: false, error: 'No headers found in CSV.' }, { status: 400 });
    }

    let requestedMapping = undefined;
    if (typeof mappingRaw === 'string' && mappingRaw.trim()) {
      let parsedMapping: unknown;
      try {
        parsedMapping = JSON.parse(mappingRaw);
      } catch {
        return NextResponse.json({ ok: false, error: 'Invalid column mapping JSON.' }, { status: 400 });
      }

      const mappingResult = FinanceColumnMappingSchema.safeParse(parsedMapping);
      if (!mappingResult.success) {
        return NextResponse.json({ ok: false, error: 'Invalid column mapping payload.' }, { status: 400 });
      }
      requestedMapping = mappingResult.data;
    }

    const supabase = createServerClient();
    const config = await loadFinanceTransformationConfig(supabase);

    const preview = transformFinanceRows({
      sourceFileName: file.name,
      headers: parsed.headers,
      rows: parsed.rows,
      requestedMapping,
      config
    });

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to parse finance CSV upload.'
      },
      { status: 500 }
    );
  }
}
