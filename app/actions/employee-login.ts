'use server';

import { randomBytes, scryptSync } from 'crypto';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentById } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  EmployeeLoginProfile,
  errorResult,
  generateCorrelationId,
  Result,
  successResult
} from '@/lib/types';
import { EmployeeLoginCredentialsSchema, zodFieldErrors } from '@/lib/validation';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function updateEmployeeLoginCredentials(
  employeeId: string,
  username: string,
  password: string
): Promise<Result<EmployeeLoginProfile>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.settings.edit');
    if (!allowed) {
      return errorResult(
        correlationId,
        'FORBIDDEN',
        'You do not have permission to manage login credentials.'
      );
    }

    const parsed = EmployeeLoginCredentialsSchema.safeParse({
      employee_id: employeeId,
      username,
      password
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid login credentials payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const student = await getStudentById(supabase, parsed.data.employee_id);
    if (!student) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Employee does not exist', {
        employee_id: 'Employee was not found in students table'
      });
    }

    const { data: existing } = await supabase
      .from('employee_login_credentials')
      .select('employee_id, username, password_updated_at')
      .eq('employee_id', parsed.data.employee_id)
      .maybeSingle();

    const { data, error } = await supabase
      .from('employee_login_credentials')
      .upsert(
        {
          employee_id: parsed.data.employee_id,
          username: parsed.data.username,
          password_hash: hashPassword(parsed.data.password),
          password_updated_at: new Date().toISOString()
        },
        {
          onConflict: 'employee_id'
        }
      )
      .select('employee_id, username, password_updated_at')
      .single();

    if (error || !data) {
      return errorResult(
        correlationId,
        'DB_ERROR',
        error?.message ?? 'Unable to update login credentials'
      );
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'employee_login_credentials_updated',
        tableName: 'employee_login_credentials',
        recordId: String(parsed.data.employee_id),
        oldValue: existing ?? null,
        newValue: {
          employee_id: data.employee_id,
          username: data.username,
          password_updated_at: data.password_updated_at
        },
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('employee_login_credentials_updated', {
      correlationId,
      employeeId: parsed.data.employee_id,
      username: parsed.data.username
    });

    return successResult(data as EmployeeLoginProfile, correlationId);
  } catch (error) {
    logError('update_employee_login_credentials_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to update login credentials.');
  }
}

export async function getEmployeeLoginProfiles(): Promise<Result<EmployeeLoginProfile[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.settings.edit');
    if (!allowed) {
      return errorResult(
        correlationId,
        'FORBIDDEN',
        'You do not have permission to view login credentials.'
      );
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('employee_login_credentials')
      .select('employee_id, username, password_updated_at')
      .order('username', { ascending: true });

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    logInfo('employee_login_profiles_read', {
      correlationId,
      rows: (data ?? []).length
    });

    return successResult((data ?? []) as EmployeeLoginProfile[], correlationId);
  } catch (error) {
    logError('get_employee_login_profiles_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load login profiles.');
  }
}
