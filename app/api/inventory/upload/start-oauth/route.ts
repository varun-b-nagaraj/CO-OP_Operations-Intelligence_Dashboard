import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://inventory-upload.vercel.app/api/oauth/start', {
      method: 'GET',
      cache: 'no-store'
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: payload }, { status: response.status });
    }

    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'OAuth start failed' },
      { status: 500 }
    );
  }
}
