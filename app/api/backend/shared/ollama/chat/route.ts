import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function normalizeBaseUrl(baseUrlRaw: string | undefined): string {
  const raw = (baseUrlRaw?.trim() || 'https://ollama.com').replace(/\/+$/, '');
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
  const addUnique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  if (baseUrl.endsWith('/api/chat')) {
    return addUnique([baseUrl]);
  }
  if (baseUrl.endsWith('/api')) {
    return addUnique([`${baseUrl}/chat`]);
  }
  return addUnique([`${baseUrl}/api/chat`]);
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
  const configuredBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL);
  const configuredHostname = (() => {
    try {
      return new URL(configuredBaseUrl).hostname;
    } catch {
      return '';
    }
  })();
  const requestHostname = request.nextUrl.hostname.toLowerCase();
  const shouldFallbackToCloudBase = configuredHostname.toLowerCase() === requestHostname;
  const effectiveBaseUrl = shouldFallbackToCloudBase ? 'https://ollama.com' : configuredBaseUrl;
  const targetCandidates = resolveOllamaChatUrlCandidates(effectiveBaseUrl);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('host');
  requestHeaders.delete('content-length');

  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (!apiKey && configuredHostname === 'ollama.com') {
    return NextResponse.json(
      {
        ok: false,
        error: 'OLLAMA_API_KEY is required when using ollama.com.',
        configuredBaseUrl,
        hint: 'Set OLLAMA_API_KEY in Vercel project environment variables.'
      },
      { status: 500 }
    );
  }
  if (apiKey) {
    requestHeaders.set('Authorization', `Bearer ${apiKey}`);
    requestHeaders.set('X-API-Key', apiKey);
    requestHeaders.set('api-key', apiKey);
  }
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const requestBody = new Uint8Array(await request.arrayBuffer());
  const attempts: Array<{ url: string; status: number }> = [];
  let bestFailureResponse: Response | null = null;
  let bestFailureStatus = -1;
  let lastError: unknown = null;

  for (const targetUrl of targetCandidates) {
    let timeout: NodeJS.Timeout | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 45_000);
      const upstreamResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal
      });
      clearTimeout(timeout);
      timeout = null;
      attempts.push({ url: targetUrl, status: upstreamResponse.status });

      if (upstreamResponse.ok) {
        const headers = copyResponseHeaders(upstreamResponse.headers);
        headers.set('x-coop-backend-proxy-target', targetUrl);
        headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
        if (shouldFallbackToCloudBase) {
          headers.set(
            'x-coop-backend-proxy-warning',
            'OLLAMA_BASE_URL matched this app host; proxy used https://ollama.com fallback.'
          );
        }
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers
        });
      }

      const contentType = upstreamResponse.headers.get('content-type')?.toLowerCase() ?? '';
      if (upstreamResponse.status === 401 && contentType.includes('text/html')) {
        const html = await upstreamResponse.text();
        if (html.toLowerCase().includes('vercel authentication')) {
          return NextResponse.json(
            {
              ok: false,
              error:
                'OLLAMA_BASE_URL points to a Vercel-protected page, not a public Ollama API endpoint.',
              configuredBaseUrl,
              effectiveBaseUrl,
              targetUrl,
              hint:
                'Set OLLAMA_BASE_URL to https://ollama.com and keep OLLAMA_API_KEY set in Vercel env vars.',
              attempts
            },
            { status: 502 }
          );
        }
      }

      // Keep the most relevant upstream failure status for diagnostics.
      if (upstreamResponse.status > bestFailureStatus) {
        bestFailureStatus = upstreamResponse.status;
        bestFailureResponse = upstreamResponse;
      }
    } catch (error) {
      lastError = error;
      attempts.push({ url: targetUrl, status: 0 });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  if (bestFailureResponse) {
    const headers = copyResponseHeaders(bestFailureResponse.headers);
    headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
    return new Response(bestFailureResponse.body, {
      status: bestFailureResponse.status,
      statusText: bestFailureResponse.statusText,
      headers
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: lastError instanceof Error ? lastError.message : 'Failed to reach Ollama upstream.',
      configuredBaseUrl,
      effectiveBaseUrl,
      attempts,
      hint:
        'Verify OLLAMA_BASE_URL and OLLAMA_API_KEY in Vercel project env vars. If using ollama.com, keep base URL as https://ollama.com.'
    },
    { status: 502 }
  );
}
