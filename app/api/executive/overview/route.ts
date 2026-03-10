import { NextResponse } from 'next/server';

import { fetchExecutiveOverview } from '@/lib/server/executive';

export async function GET() {
  try {
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
