import { NextRequest } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { proxyOllamaChatRequest } from '@/lib/server/ollama-proxy';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const allowed = await ensureServerPermission('executive.ai_agent.view');
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  return proxyOllamaChatRequest({
    body,
    incomingHeaders: request.headers
  });
}
