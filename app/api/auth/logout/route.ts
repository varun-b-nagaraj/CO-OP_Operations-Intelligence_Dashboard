import { NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, revokeAuthSessionByCookie } from '@/lib/server/auth';

export async function POST() {
  await revokeAuthSessionByCookie();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0)
  });

  return response;
}
