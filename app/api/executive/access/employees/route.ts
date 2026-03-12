import { randomBytes, scryptSync } from 'crypto';

import { NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import { listEmployeeAccess } from '@/lib/server/access-control';
import { createServerClient } from '@/lib/supabase';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function GET() {
  const allowed = await ensureServerPermission('executive.access_control.view');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const employees = await listEmployeeAccess();
  return NextResponse.json({ ok: true, employees });
}

export async function POST(request: Request) {
  const allowed = await ensureServerPermission('executive.access_control.edit');
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const payload = (await request.json()) as {
    name?: unknown;
    s_number?: unknown;
    password?: unknown;
  };

  const name = String(payload.name ?? '').trim();
  const sNumber = String(payload.s_number ?? '').trim();
  const password = typeof payload.password === 'string' ? payload.password.trim() : '';

  if (!name || !sNumber) {
    return NextResponse.json(
      { ok: false, error: 'Employee name and s_number are required.' },
      { status: 400 }
    );
  }

  if (password && password.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'Password must be at least 8 characters.' },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const { data: referenceStudent } = await supabase.from('students').select('*').limit(1).maybeSingle();
  const insertPayload: Record<string, unknown> = {};

  if (referenceStudent && ('name' in referenceStudent || !('full_name' in referenceStudent))) {
    insertPayload.name = name;
  }
  if (referenceStudent && 'full_name' in referenceStudent) {
    insertPayload.full_name = name;
  }
  if (referenceStudent && 'student_name' in referenceStudent) {
    insertPayload.student_name = name;
  }

  if (referenceStudent && ('s_number' in referenceStudent || !('student_number' in referenceStudent))) {
    insertPayload.s_number = sNumber;
  }
  if (referenceStudent && 'student_number' in referenceStudent) {
    insertPayload.student_number = sNumber;
  }

  if (referenceStudent && 'scheduleable' in referenceStudent) {
    insertPayload.scheduleable = false;
  }
  if (referenceStudent && 'schedulable' in referenceStudent) {
    insertPayload.schedulable = false;
  }
  if (referenceStudent && 'assigned_periods' in referenceStudent) {
    insertPayload.assigned_periods = '';
  }
  if (referenceStudent && 'Schedule' in referenceStudent) {
    insertPayload.Schedule = null;
  }

  if (Object.keys(insertPayload).length === 0) {
    insertPayload.name = name;
    insertPayload.s_number = sNumber;
    insertPayload.scheduleable = false;
  }

  const { data: insertedEmployee, error: insertError } = await supabase
    .from('students')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertError || !insertedEmployee?.id) {
    return NextResponse.json(
      { ok: false, error: insertError?.message ?? 'Unable to create employee.' },
      { status: 400 }
    );
  }

  const employeeId = String(insertedEmployee.id);

  const { data: employeeRole } = await supabase
    .from('access_role_templates')
    .select('id')
    .eq('role_key', 'employee')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (employeeRole?.id) {
    await supabase.from('employee_role_assignments').upsert(
      {
        employee_id: employeeId,
        role_template_id: employeeRole.id,
        is_primary: true,
        assigned_by: 'executive_access_create'
      },
      { onConflict: 'employee_id,role_template_id' }
    );
  }

  if (password) {
    const passwordHash = hashPassword(password);
    const passwordUpdatedAt = new Date().toISOString();

    let { error: passwordError } = await supabase.from('employee_login_credentials').upsert(
      {
        employee_id: employeeId,
        password_hash: passwordHash,
        password_updated_at: passwordUpdatedAt
      },
      { onConflict: 'employee_id' }
    );

    if (passwordError && /username/i.test(passwordError.message)) {
      const retry = await supabase.from('employee_login_credentials').upsert(
        {
          employee_id: employeeId,
          username: sNumber,
          password_hash: passwordHash,
          password_updated_at: passwordUpdatedAt
        },
        { onConflict: 'employee_id' }
      );
      passwordError = retry.error;
    }

    if (passwordError) {
      return NextResponse.json(
        { ok: false, error: `Password save failed: ${passwordError.message}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, employee_id: employeeId });
}
