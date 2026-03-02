import { NextRequest } from 'next/server';

export type BackendDepartment = 'hr' | 'marketing' | 'product' | 'inventory' | 'shared';

type RouteContext = { params: Promise<{ supabasePath: string[] }> };
type RouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

function buildTargetUrl(request: NextRequest, supabasePath: string[]): URL {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }

  const base = new URL(baseUrl);
  const target = new URL(base.toString());
  target.pathname = `/${supabasePath.join('/')}`;
  target.search = request.nextUrl.search;
  return target;
}

function copyResponseHeaders(sourceHeaders: Headers, department: BackendDepartment): Headers {
  const headers = new Headers();
  for (const [key, value] of sourceHeaders.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'content-encoding') continue;
    if (lowerKey === 'content-length') continue;
    headers.set(key, value);
  }
  headers.set('x-coop-backend-department', department);
  return headers;
}

async function proxySupabaseRequest(
  request: NextRequest,
  params: { supabasePath: string[] },
  department: BackendDepartment
) {
  const targetUrl = buildTargetUrl(request, params.supabasePath);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('host');
  requestHeaders.delete('content-length');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstreamInit: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: requestHeaders,
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? 'half' : undefined
  };
  const upstreamResponse = await fetch(targetUrl, upstreamInit as RequestInit);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: copyResponseHeaders(upstreamResponse.headers, department)
  });
}

export function createDepartmentSupabaseProxyHandlers(department: BackendDepartment): Record<string, RouteHandler> {
  const handle = async (request: NextRequest, context: RouteContext) =>
    proxySupabaseRequest(request, await context.params, department);

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    HEAD: handle,
    OPTIONS: handle
  };
}
