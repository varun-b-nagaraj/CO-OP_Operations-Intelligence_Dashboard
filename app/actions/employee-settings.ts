'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentById } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  EmployeeSettings,
  errorResult,
  generateCorrelationId,
  Result,
  successResult
} from '@/lib/types';
import { EmployeeSettingsSchema, zodFieldErrors } from '@/lib/validation';

function normalizeOffPeriods(offPeriods: number[]): number[] {
  return [...new Set(offPeriods)].sort((left, right) => left - right);
}

export async function updateEmployeeOffPeriods(
  employeeId: string,
  offPeriods: number[]
): Promise<Result<EmployeeSettings>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.settings.edit');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to update settings.');
    }

    const supabase = createServerClient();
    const student = await getStudentById(supabase, employeeId);
    if (!student || !student.s_number) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Employee does not exist', {
        employee_id: 'Employee was not found in students table'
      });
    }

    const parsed = EmployeeSettingsSchema.safeParse({
      employee_id: employeeId,
      employee_s_number: student.s_number,
      off_periods: normalizeOffPeriods(offPeriods)
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid employee settings payload',
        zodFieldErrors(parsed.error)
      );
    }

    const { data: existing } = await supabase
      .from('employee_settings')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('employee_settings')
      .upsert(
        {
          employee_id: parsed.data.employee_id,
          employee_s_number: parsed.data.employee_s_number,
          off_periods: parsed.data.off_periods
        },
        {
          onConflict: 'employee_id'
        }
      )
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to update settings');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'employee_off_periods_updated',
        tableName: 'employee_settings',
        recordId: data.id,
        oldValue: existing ?? null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('employee_settings_updated', {
      correlationId,
      employeeId,
      offPeriods: parsed.data.off_periods
    });

    return successResult(data as EmployeeSettings, correlationId);
  } catch (error) {
    logError('update_employee_settings_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to update employee settings.');
  }
}

export async function getEmployeeSettings(employeeId: string): Promise<Result<EmployeeSettings>> {
  const correlationId = generateCorrelationId();

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('employee_settings')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    if (!data) {
      const student = await getStudentById(supabase, employeeId);
      if (!student || !student.s_number) {
        return errorResult(correlationId, 'NOT_FOUND', 'Employee settings not found.');
      }

      const { data: created, error: createError } = await supabase
        .from('employee_settings')
        .insert({
          employee_id: employeeId,
          employee_s_number: student.s_number,
          off_periods: [4, 8]
        })
        .select('*')
        .single();

      if (createError || !created) {
        return errorResult(correlationId, 'DB_ERROR', createError?.message ?? 'Unable to initialize settings');
      }

      logInfo('employee_settings_initialized', {
        correlationId,
        employeeId
      });

      return successResult(created as EmployeeSettings, correlationId);
    }

    logInfo('employee_settings_read', {
      correlationId,
      employeeId
    });

    return successResult(data as EmployeeSettings, correlationId);
  } catch (error) {
    logError('get_employee_settings_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load employee settings.');
  }
}

export async function getAllEmployeeSettings(): Promise<Result<EmployeeSettings[]>> {
  const correlationId = generateCorrelationId();

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('employee_settings').select('*');
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    logInfo('employee_settings_all_read', {
      correlationId,
      count: (data ?? []).length
    });

    return successResult((data ?? []) as EmployeeSettings[], correlationId);
  } catch (error) {
    logError('get_all_employee_settings_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load employee settings.');
  }
}
