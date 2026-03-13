import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';
import { logHourAudit, reviewHourRequest } from '@/lib/server/hours-requests';
import { ensureServerPermission } from '@/lib/server/permissions';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const allowed =
      (await ensureServerPermission('executive.hours:approve:all')) ||
      (await ensureServerPermission('executive.access:manage:all'));
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const { requestId } = await params;
    if (!requestId) {
      return NextResponse.json({ ok: false, error: 'requestId is required' }, { status: 400 });
    }

    const body = (await request.json()) as {
      status?: 'approved' | 'denied';
      approved_hours?: number;
      review_notes?: string;
    };
    if (body.status !== 'approved' && body.status !== 'denied') {
      return NextResponse.json({ ok: false, error: 'status must be approved or denied' }, { status: 400 });
    }

    const approvedHours = body.approved_hours === undefined ? undefined : Number(body.approved_hours);
    if (
      body.status === 'approved' &&
      approvedHours !== undefined &&
      (!Number.isFinite(approvedHours) || approvedHours <= 0 || approvedHours > 24)
    ) {
      return NextResponse.json({ ok: false, error: 'approved_hours must be between 0 and 24' }, { status: 400 });
    }

    const actor = (await getServerAuthContext())?.sNumber ?? 'open_access';
    const supabase = createServerClient();
    const updated = await reviewHourRequest(supabase, {
      requestId,
      status: body.status,
      actor,
      approvedHours,
      reviewNotes: String(body.review_notes ?? '').trim() || null
    });

    await logHourAudit(supabase, {
      actor,
      action: body.status === 'approved' ? 'employee_hours_approved' : 'employee_hours_denied',
      recordId: updated.id,
      newValue: updated as unknown as Record<string, unknown>
    });

    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to review hour request' },
      { status: 500 }
    );
  }
}
