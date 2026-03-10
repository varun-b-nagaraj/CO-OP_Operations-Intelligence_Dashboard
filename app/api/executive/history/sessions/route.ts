import { NextRequest, NextResponse } from 'next/server';

import { listConversationSessions, resolveUserKey } from '@/lib/server/executive-memory';

export async function GET(request: NextRequest) {
  try {
    const userKey = resolveUserKey(request.nextUrl.searchParams.get('userKey'));
    const sessions = await listConversationSessions(userKey);
    return NextResponse.json({ ok: true, sessions });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load conversation sessions.'
      },
      { status: 500 }
    );
  }
}
