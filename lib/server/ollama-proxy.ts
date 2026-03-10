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

function isDebugEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.EXECUTIVE_AI_DEBUG ?? '').trim());
}

function debugLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  debugId: string,
  details: Record<string, unknown>
) {
  if (!isDebugEnabled()) return;
  const payload = {
    scope: 'ollama_proxy',
    event,
    debugId,
    at: new Date().toISOString(),
    ...details
  };
  const line = `[ollama-proxy] ${JSON.stringify(payload)}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function isAllowedOllamaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'ollama.com' || host.endsWith('.ollama.com') || host === 'localhost' || host === '127.0.0.1';
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
  const debugId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const configuredBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL);
  const configuredHostname = (() => {
    try {
      return new URL(configuredBaseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const baseHeaders = new Headers();
  baseHeaders.set('x-coop-ollama-debug-id', debugId);
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  let parsedBodyMeta: Record<string, unknown> = {};
  try {
    const bodyText =
      params.body instanceof Uint8Array ? new TextDecoder().decode(params.body) : JSON.stringify(params.body);
    const parsed = JSON.parse(bodyText) as {
      model?: unknown;
      stream?: unknown;
      messages?: unknown;
      options?: unknown;
    };
    parsedBodyMeta = {
      model: typeof parsed.model === 'string' ? parsed.model : null,
      stream: typeof parsed.stream === 'boolean' ? parsed.stream : null,
      messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : null,
      hasOptions: Boolean(parsed.options && typeof parsed.options === 'object')
    };
  } catch {
    parsedBodyMeta = { parseableJsonBody: false };
  }
  debugLog('info', 'request_start', debugId, {
    configuredBaseUrl,
    configuredHostname,
    hasApiKey: Boolean(apiKey),
    timeoutMs: params.timeoutMs ?? 45_000,
    ...parsedBodyMeta
  });

  if (configuredHostname && !isAllowedOllamaHost(configuredHostname)) {
    debugLog('error', 'invalid_host', debugId, { configuredHostname, configuredBaseUrl });
    return jsonResponse(
      {
        ok: false,
        error: `Invalid OLLAMA_BASE_URL host "${configuredHostname}".`,
        configuredBaseUrl,
        debugId,
        hint: 'Use https://ollama.com for cloud Ollama, or localhost/127.0.0.1 for local Ollama.'
      },
      500,
      baseHeaders
    );
  }
  if (configuredHostname.endsWith('.vercel.app')) {
    debugLog('error', 'vercel_host_rejected', debugId, { configuredHostname, configuredBaseUrl });
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid OLLAMA_BASE_URL: it points to a Vercel app host, not the Ollama API host.',
        configuredBaseUrl,
        debugId,
        hint: 'Set OLLAMA_BASE_URL to https://ollama.com.'
      },
      500,
      baseHeaders
    );
  }

  const targetCandidates = resolveOllamaChatUrlCandidates(configuredBaseUrl);
  debugLog('info', 'target_candidates_resolved', debugId, { targetCandidates });
  const requestHeaders = new Headers(params.incomingHeaders);
  requestHeaders.delete('host');
  requestHeaders.delete('content-length');
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (!apiKey && configuredHostname === 'ollama.com') {
    debugLog('error', 'missing_api_key', debugId, { configuredBaseUrl });
    return jsonResponse(
      {
        ok: false,
        error: 'OLLAMA_API_KEY is required when using ollama.com.',
        configuredBaseUrl,
        debugId,
        hint: 'Set OLLAMA_API_KEY in environment variables.'
      },
      500,
      baseHeaders
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
    const startedAt = Date.now();
    debugLog('info', 'upstream_attempt_start', debugId, { targetUrl });
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
      const elapsedMs = Date.now() - startedAt;
      const contentType = upstreamResponse.headers.get('content-type')?.toLowerCase() ?? '';
      debugLog('info', 'upstream_attempt_complete', debugId, {
        targetUrl,
        status: upstreamResponse.status,
        elapsedMs,
        contentType
      });
      if (upstreamResponse.ok) {
        const headers = copyResponseHeaders(upstreamResponse.headers);
        headers.set('x-coop-backend-proxy-target', targetUrl);
        headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
        headers.set('x-coop-ollama-debug-id', debugId);
        debugLog('info', 'upstream_success', debugId, {
          targetUrl,
          status: upstreamResponse.status,
          attempts: attempts.length
        });
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers
        });
      }

      if (upstreamResponse.status === 401) {
        const html = await upstreamResponse.text();
        const normalized = html.toLowerCase();
        if (
          contentType.includes('text/html') ||
          normalized.includes('<!doctype html') ||
          normalized.includes('authentication required') ||
          normalized.includes('vercel')
        ) {
          debugLog('error', 'vercel_auth_html_detected', debugId, {
            targetUrl,
            status: upstreamResponse.status,
            snippet: html.slice(0, 200)
          });
          return jsonResponse(
            {
              ok: false,
              error:
                'OLLAMA_BASE_URL points to a Vercel-protected page, not a public Ollama API endpoint.',
              configuredBaseUrl,
              targetUrl,
              debugId,
              hint: 'Set OLLAMA_BASE_URL=https://ollama.com and keep OLLAMA_API_KEY configured.',
              attempts
            },
            502,
            baseHeaders
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
      debugLog('error', 'upstream_attempt_exception', debugId, {
        targetUrl,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'Unknown upstream fetch error'
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  if (bestFailureResponse) {
    const headers = copyResponseHeaders(bestFailureResponse.headers);
    headers.set('x-coop-backend-proxy-attempts', JSON.stringify(attempts));
    headers.set('x-coop-ollama-debug-id', debugId);
    debugLog('warn', 'upstream_best_failure', debugId, {
      bestFailureStatus,
      attempts
    });
    return new Response(bestFailureResponse.body, {
      status: bestFailureResponse.status,
      statusText: bestFailureResponse.statusText,
      headers
    });
  }

  debugLog('error', 'all_attempts_failed', debugId, {
    attempts,
    lastError: lastError instanceof Error ? lastError.message : 'Unknown error'
  });
  return jsonResponse(
    {
      ok: false,
      error: lastError instanceof Error ? lastError.message : 'Failed to reach Ollama upstream.',
      configuredBaseUrl,
      debugId,
      attempts
    },
    502,
    baseHeaders
  );
}
