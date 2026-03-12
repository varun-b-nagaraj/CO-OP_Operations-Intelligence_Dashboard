import { NextRequest, NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import {
  deleteConversationMessage,
  listConversationMessages,
  resolveUserKey
} from '@/lib/server/executive-memory';

export async function GET(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('executive.ai_agent.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const userKey = resolveUserKey(request.nextUrl.searchParams.get('userKey'));
    const sessionId = (request.nextUrl.searchParams.get('sessionId') ?? '').trim();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'sessionId is required.' }, { status: 400 });
    }

    const messages = await listConversationMessages({ userKey, sessionId });
    return NextResponse.json({ ok: true, messages });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load conversation messages.'
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('executive.ai_agent.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const userKey = resolveUserKey(request.nextUrl.searchParams.get('userKey'));
    const messageId = (request.nextUrl.searchParams.get('messageId') ?? '').trim();
    if (!messageId) {
      return NextResponse.json({ ok: false, error: 'messageId is required.' }, { status: 400 });
    }

    await deleteConversationMessage({ userKey, messageId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to delete conversation message.'
      },
      { status: 500 }
    );
  }
}
