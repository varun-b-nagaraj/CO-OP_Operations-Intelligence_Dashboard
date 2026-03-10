import { NextRequest } from 'next/server';

function resolveOllamaChatUrl(baseUrlRaw: string | undefined): string {
  const baseUrl = (baseUrlRaw?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
  if (baseUrl.endsWith('/api/chat')) return baseUrl;
  if (baseUrl.endsWith('/api')) return `${baseUrl}/chat`;
  return `${baseUrl}/api/chat`;
}

function copyResponseHeaders(sourceHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of sourceHeaders.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'content-encoding') continue;
    if (lowerKey === 'content-length') continue;
    headers.set(key, value);
  }
  headers.set('x-coop-backend-department', 'shared');
  headers.set('x-coop-backend-proxy', 'ollama');
  return headers;
}

export async function POST(request: NextRequest) {
  const targetUrl = resolveOllamaChatUrl(process.env.OLLAMA_BASE_URL);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('host');
  requestHeaders.delete('content-length');

  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (apiKey) {
    requestHeaders.set('Authorization', `Bearer ${apiKey}`);
  }
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const upstreamResponse = await fetch(targetUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: request.body,
    duplex: 'half'
  } as RequestInit);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: copyResponseHeaders(upstreamResponse.headers)
  });
}
