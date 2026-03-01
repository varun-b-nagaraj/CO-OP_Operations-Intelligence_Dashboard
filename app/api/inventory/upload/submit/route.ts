import { NextRequest, NextResponse } from 'next/server';

import { getSessionFinalItems, writeUploadRun } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      session_id?: string;
      triggered_by?: string;
      count_name?: string;
      shop_id?: string;
      employee_id?: string;
      reconcile?: boolean;
      rps?: number;
      items?: Array<{ system_id: string; qty: number }>;
      actor_role?: 'host' | 'participant';
    };

    if (body.actor_role && body.actor_role !== 'host') {
      return NextResponse.json({ ok: false, error: 'Only host can upload.' }, { status: 403 });
    }

    const sessionId = String(body.session_id ?? '').trim();
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'session_id is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const items = body.items?.length ? body.items : await getSessionFinalItems(supabase, sessionId);

    if (!items.length) {
      return NextResponse.json({ ok: false, error: 'No finalized items found to upload' }, { status: 400 });
    }

    const payload = {
      count_name: body.count_name || `Inventory Session ${sessionId}`,
      shop_id: body.shop_id || '1',
      employee_id: body.employee_id || '1',
      reconcile: body.reconcile !== false,
      rps: Math.max(0.05, Math.min(1, body.rps ?? 0.3)),
      items: items.map((item) => ({
        system_id: String(item.system_id).trim(),
        qty: Number(item.qty) || 0
      }))
    };

    const upstream = await fetch('https://inventory-upload.vercel.app/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const upstreamPayload = (await upstream.json()) as Record<string, unknown>;

    await writeUploadRun(supabase, {
      session_id: sessionId,
      triggered_by: body.triggered_by || 'open_access',
      count_name: payload.count_name,
      shop_id: payload.shop_id,
      employee_id: payload.employee_id,
      reconcile: payload.reconcile,
      request_items: payload.items,
      response_payload: {
        ok: Boolean(upstreamPayload.ok ?? upstream.ok),
        ...upstreamPayload
      },
      response_status: upstream.status
    });

    return NextResponse.json({
      ok: upstream.ok,
      warning: 'Omitted items will be set to 0 by backend reconcile.',
      upstream: upstreamPayload
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
