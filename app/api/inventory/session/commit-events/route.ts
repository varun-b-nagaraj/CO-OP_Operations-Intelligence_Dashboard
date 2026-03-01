import { NextRequest, NextResponse } from 'next/server';

import { normalizeIdentifier } from '@/lib/inventory/identifiers';
import { InventoryCountEvent } from '@/lib/inventory/types';
import { commitEvents } from '@/lib/server/inventory';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      session_id?: string;
      actor_id?: string;
      actor_name?: string;
      events?: InventoryCountEvent[];
    };

    const sessionId = normalizeIdentifier(body.session_id);
    const actorId = normalizeIdentifier(body.actor_id);
    const actorName = normalizeIdentifier(body.actor_name) || 'Counter';
    const events = Array.isArray(body.events) ? body.events : [];

    if (!sessionId || !actorId) {
      return NextResponse.json({ ok: false, error: 'session_id and actor_id are required' }, { status: 400 });
    }

    const cleanedEvents = events
      .map((event) => ({
        session_id: sessionId,
        event_id: normalizeIdentifier(event.event_id),
        actor_id: normalizeIdentifier(event.actor_id) || actorId,
        system_id: normalizeIdentifier(event.system_id),
        delta_qty: Number(event.delta_qty) || 0,
        timestamp: event.timestamp || new Date().toISOString()
      }))
      .filter((event) => event.event_id && event.system_id && event.delta_qty !== 0);

    const supabase = createServerClient();
    const result = await commitEvents(supabase, {
      session_id: sessionId,
      actor_id: actorId,
      actor_name: actorName,
      events: cleanedEvents
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to commit events' },
      { status: 500 }
    );
  }
}
