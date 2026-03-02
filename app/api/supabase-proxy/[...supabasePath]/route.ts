import { NextRequest } from 'next/server';

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

function copyResponseHeaders(sourceHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of sourceHeaders.entries()) {
    if (key.toLowerCase() === 'content-encoding') continue;
    if (key.toLowerCase() === 'content-length') continue;
    headers.set(key, value);
  }
  return headers;
}

async function handleProxy(request: NextRequest, params: { supabasePath: string[] }) {
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
    headers: copyResponseHeaders(upstreamResponse.headers)
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ supabasePath: string[] }> }
) {
  return handleProxy(request, await context.params);
}
