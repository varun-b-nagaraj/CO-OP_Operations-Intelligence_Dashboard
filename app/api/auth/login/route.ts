import { scryptSync, timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import {
  AUTH_COOKIE_NAME,
  buildAuthCookieConfig,
  createAuthSession,
  getHardcodedExecSessionToken,
  getServerAuthContext,
  isHardcodedExecCredential
} from '@/lib/server/auth';
import { getStudentBySNumber } from '@/lib/server/employees';
import { createServerClient } from '@/lib/supabase';

interface LoginPayload {
  employee_id?: unknown;
  password?: unknown;
}

function verifyPassword(hashValue: string, candidatePassword: string): boolean {
  const parts = hashValue.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [, salt, expectedHashHex] = parts;
  const candidateHashHex = scryptSync(candidatePassword, salt, 64).toString('hex');

  const expectedBuffer = Buffer.from(expectedHashHex, 'hex');
  const actualBuffer = Buffer.from(candidateHashHex, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function POST(request: Request) {
  let payload: LoginPayload;

  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON payload.' },
      { status: 400 }
    );
  }

  const employeeIdInput = String(payload.employee_id ?? '').trim();
  const password = String(payload.password ?? '');

  if (!employeeIdInput || !password) {
    return NextResponse.json(
      { ok: false, error: 'Employee ID and password are required.' },
      { status: 400 }
    );
  }

  if (isHardcodedExecCredential(employeeIdInput, password)) {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      AUTH_COOKIE_NAME,
      getHardcodedExecSessionToken(),
      buildAuthCookieConfig(expiresAt)
    );
    response.headers.set('x-auth-role', 'exec');
    return response;
  }

  const supabase = createServerClient();

  const student = await getStudentBySNumber(supabase, employeeIdInput);

  if (!student) {
    return NextResponse.json(
      { ok: false, error: 'No employee was found for that ID.' },
      { status: 401 }
    );
  }

  const { data: credentialRow } = await supabase
    .from('employee_login_credentials')
    .select('employee_id,password_hash')
    .eq('employee_id', String(student.id))
    .maybeSingle();

  const passwordHash = String(credentialRow?.password_hash ?? '');
  if (!passwordHash) {
    return NextResponse.json(
      { ok: false, error: 'No password has been configured for this employee. Contact HR.' },
      { status: 401 }
    );
  }

  if (!verifyPassword(passwordHash, password)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid employee ID or password.' },
      { status: 401 }
    );
  }

  const createdSession = await createAuthSession(String(student.id));
  if (!createdSession) {
    return NextResponse.json(
      { ok: false, error: 'Unable to create session.' },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    AUTH_COOKIE_NAME,
    createdSession.token,
    buildAuthCookieConfig(createdSession.expiresAt)
  );

  const authContext = await getServerAuthContext();
  if (authContext) {
    response.headers.set('x-auth-role', authContext.role ?? 'employee');
  }

  return response;
}
