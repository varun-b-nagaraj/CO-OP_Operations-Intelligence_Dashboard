import { NextRequest } from 'next/server';

import { proxyOllamaChatRequest } from '@/lib/server/ollama-proxy';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = new Uint8Array(await request.arrayBuffer());
  return proxyOllamaChatRequest({
    body,
    incomingHeaders: request.headers
  });
}
