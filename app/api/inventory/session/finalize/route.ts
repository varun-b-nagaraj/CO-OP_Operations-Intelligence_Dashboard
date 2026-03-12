import { NextRequest, NextResponse } from 'next/server';

import { normalizeIdentifier } from '@/lib/inventory/identifiers';
import { ensureServerPermission } from '@/lib/server/permissions';
import { finalizeSession } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('inventory.finalize_upload.edit');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      session_id?: string;
      finalized_by?: string;
      lock?: boolean;
    };

    const sessionId = normalizeIdentifier(body.session_id);
    const finalizedBy = normalizeIdentifier(body.finalized_by) || 'open_access';

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'session_id is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const result = await finalizeSession(supabase, {
      session_id: sessionId,
      finalized_by: finalizedBy,
      lock: body.lock !== false
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to finalize session' },
      { status: 500 }
    );
  }
}
