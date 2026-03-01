import { NextRequest, NextResponse } from 'next/server';

import { createInventorySession, upsertParticipant } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      session_name?: string;
      host_id?: string;
      created_by?: string;
      baseline_session_id?: string | null;
      host_name?: string;
    };

    const sessionName = (body.session_name ?? '').trim();
    const hostId = (body.host_id ?? '').trim();
    const createdBy = (body.created_by ?? 'open_access').trim();
    const hostName = (body.host_name ?? 'Host').trim();

    if (!sessionName || !hostId) {
      return NextResponse.json({ ok: false, error: 'session_name and host_id are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const session = await createInventorySession(supabase, {
      session_name: sessionName,
      host_id: hostId,
      created_by: createdBy,
      baseline_session_id: body.baseline_session_id ?? null
    });

    await upsertParticipant(supabase, session.id, hostId, hostName);

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create session' },
      { status: 500 }
    );
  }
}
