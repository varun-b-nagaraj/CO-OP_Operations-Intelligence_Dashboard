import { NextResponse } from 'next/server';

import { getServerAuthContext } from '@/lib/server/auth';

export async function GET() {
  const user = await getServerAuthContext();
  return NextResponse.json({
    ok: true,
    user: user
      ? {
          id: user.id,
          role: user.role,
          permissions: user.permissions,
          employeeId: user.employeeId,
          sNumber: user.sNumber,
          name: user.name
        }
      : null
  });
}
