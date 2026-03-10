import { NextRequest, NextResponse } from 'next/server';

function normalizeBaseUrl(baseUrlRaw: string | undefined): string {
  const raw = (baseUrlRaw?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    // Ollama cloud endpoints should use HTTPS even if env uses http://ollama.com.
    if (parsed.hostname === 'ollama.com' && parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      return parsed.toString().replace(/\/+$/, '');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

function resolveOllamaChatUrlCandidates(baseUrlRaw: string | undefined): string[] {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  if (baseUrl.endsWith('/api/chat')) {
    return [baseUrl, baseUrl.replace(/\/api\/chat$/, '/api/api/chat')];
  }
  if (baseUrl.endsWith('/api')) {
    return [`${baseUrl}/chat`, `${baseUrl}/api/chat`];
  }
  return [`${baseUrl}/api/chat`, `${baseUrl}/api/api/chat`];
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
  const targetCandidates = resolveOllamaChatUrlCandidates(process.env.OLLAMA_BASE_URL);
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

  const requestBody = new Uint8Array(await request.arrayBuffer());
  const attempts: Array<{ url: string; status: number }> = [];
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (const targetUrl of targetCandidates) {
    try {
      const upstreamResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });
      attempts.push({ url: targetUrl, status: upstreamResponse.status });
      lastResponse = upstreamResponse;

      if (upstreamResponse.ok) {
        const headers = copyResponseHeaders(upstreamResponse.headers);
        headers.set('x-coop-backend-proxy-target', targetUrl);
        headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers
        });
      }
    } catch (error) {
      lastError = error;
      attempts.push({ url: targetUrl, status: 0 });
    }
  }

  if (lastResponse) {
    const headers = copyResponseHeaders(lastResponse.headers);
    headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
    return new Response(lastResponse.body, {
      status: lastResponse.status,
      statusText: lastResponse.statusText,
      headers
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: lastError instanceof Error ? lastError.message : 'Failed to reach Ollama upstream.',
      attempts
    },
    { status: 502 }
  );
}
