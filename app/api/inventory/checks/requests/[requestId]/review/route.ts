import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import { logInventoryCheckAudit, reviewChangeRequest } from '@/lib/server/inventory-checks';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const allowed = await ensureServerPermission('inventory.attendance:requests:approve:all');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { requestId } = await params;
    if (!requestId) {
      return NextResponse.json({ ok: false, error: 'requestId is required' }, { status: 400 });
    }

    const body = (await request.json()) as {
      status?: 'approved' | 'denied';
      excuse_if_started?: boolean;
    };
    if (body.status !== 'approved' && body.status !== 'denied') {
      return NextResponse.json({ ok: false, error: 'status must be approved or denied' }, { status: 400 });
    }

    const actor = (await getServerAuthContext())?.sNumber ?? 'open_access';
    const supabase = createServerClient();
    const updated = await reviewChangeRequest(supabase, {
      request_id: requestId,
      status: body.status,
      actor,
      excuseIfStarted: body.excuse_if_started === true
    });

    await logInventoryCheckAudit(supabase, {
      inventory_check_id: updated.inventory_check_id,
      action: body.status === 'approved' ? 'inventory_check_change_request_approved' : 'inventory_check_change_request_denied',
      actor,
      record_id: updated.id,
      new_value: updated as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to review request' },
      { status: 500 }
    );
  }
}
