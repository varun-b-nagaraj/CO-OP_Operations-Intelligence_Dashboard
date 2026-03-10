import { NextRequest, NextResponse } from 'next/server';

import { listConversationMessages, resolveUserKey } from '@/lib/server/executive-memory';

export async function GET(request: NextRequest) {
  try {
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
