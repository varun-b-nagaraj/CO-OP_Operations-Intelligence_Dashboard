function normalizeBaseUrl(baseUrlRaw: string | undefined): string {
  const raw = (baseUrlRaw?.trim() || 'https://ollama.com').replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'ollama.com' && parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

function resolveOllamaChatUrlCandidates(baseUrlRaw: string | undefined): string[] {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const addUnique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  if (baseUrl.endsWith('/api/chat')) return addUnique([baseUrl]);
  if (baseUrl.endsWith('/api')) return addUnique([`${baseUrl}/chat`]);
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

function jsonResponse(payload: unknown, status: number, headers?: Headers): Response {
  const merged = new Headers(headers);
  if (!merged.has('Content-Type')) merged.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(payload), { status, headers: merged });
}

export async function proxyOllamaChatRequest(params: {
  body: Uint8Array | Record<string, unknown>;
  incomingHeaders?: Headers;
  timeoutMs?: number;
}): Promise<Response> {
  const configuredBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL);
  const configuredHostname = (() => {
    try {
      return new URL(configuredBaseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (configuredHostname.endsWith('.vercel.app')) {
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid OLLAMA_BASE_URL: it points to a Vercel app host, not the Ollama API host.',
        configuredBaseUrl,
        hint: 'Set OLLAMA_BASE_URL to https://ollama.com.'
      },
      500
    );
  }

  const targetCandidates = resolveOllamaChatUrlCandidates(configuredBaseUrl);
  const requestHeaders = new Headers(params.incomingHeaders);
  requestHeaders.delete('host');
  requestHeaders.delete('content-length');
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (!apiKey && configuredHostname === 'ollama.com') {
    return jsonResponse(
      {
        ok: false,
        error: 'OLLAMA_API_KEY is required when using ollama.com.',
        configuredBaseUrl,
        hint: 'Set OLLAMA_API_KEY in environment variables.'
      },
      500
    );
  }
  if (apiKey) {
    requestHeaders.set('Authorization', `Bearer ${apiKey}`);
    requestHeaders.set('X-API-Key', apiKey);
    requestHeaders.set('api-key', apiKey);
  }

  const requestBody: string =
    params.body instanceof Uint8Array ? new TextDecoder().decode(params.body) : JSON.stringify(params.body);
  const attempts: Array<{ url: string; status: number }> = [];
  let bestFailureResponse: Response | null = null;
  let bestFailureStatus = -1;
  let lastError: unknown = null;

  for (const targetUrl of targetCandidates) {
    let timeout: NodeJS.Timeout | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 45_000);
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
          return jsonResponse(
            {
              ok: false,
              error:
                'OLLAMA_BASE_URL points to a Vercel-protected page, not a public Ollama API endpoint.',
              configuredBaseUrl,
              targetUrl,
              hint: 'Set OLLAMA_BASE_URL=https://ollama.com and keep OLLAMA_API_KEY configured.',
              attempts
            },
            502
          );
        }
      }

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

  return jsonResponse(
    {
      ok: false,
      error: lastError instanceof Error ? lastError.message : 'Failed to reach Ollama upstream.',
      configuredBaseUrl,
      attempts
    },
    502
  );
}
