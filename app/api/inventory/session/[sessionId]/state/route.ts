import { NextRequest, NextResponse } from 'next/server';

import { getSessionState } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const state = await getSessionState(supabase, sessionId);

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load session state' },
      { status: 500 }
    );
  }
}
