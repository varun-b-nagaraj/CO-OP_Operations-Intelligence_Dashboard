'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentById } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import { errorResult, generateCorrelationId, Result, Strike, successResult } from '@/lib/types';
import { StrikeSchema, zodFieldErrors } from '@/lib/validation';

export async function addStrike(employeeId: string, reason: string): Promise<Result<Strike>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.strikes.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to manage strikes.');
    }

    const parsed = StrikeSchema.safeParse({
      employee_id: employeeId,
      reason
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid strike payload',
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

    const { data, error } = await supabase
      .from('strikes')
      .insert({
        employee_id: parsed.data.employee_id,
        reason: parsed.data.reason,
        issued_by: 'open_access',
        active: true
      })
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to add strike');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'strike_added',
        tableName: 'strikes',
        recordId: data.id,
        oldValue: null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('strike_added', {
      correlationId,
      strikeId: data.id,
      employeeId: parsed.data.employee_id
    });

    return successResult(data as Strike, correlationId);
  } catch (error) {
    logError('add_strike_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to add strike.');
  }
}

export async function removeStrike(strikeId: string): Promise<Result<Strike>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.strikes.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to manage strikes.');
    }

    const supabase = createServerClient();
    const { data: existing, error: existingError } = await supabase
      .from('strikes')
      .select('*')
      .eq('id', strikeId)
      .single();

    if (existingError || !existing) {
      return errorResult(correlationId, 'NOT_FOUND', 'Strike not found.');
    }

    const { data, error } = await supabase
      .from('strikes')
      .update({ active: false })
      .eq('id', strikeId)
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to remove strike');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'strike_removed',
        tableName: 'strikes',
        recordId: strikeId,
        oldValue: existing,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('strike_removed', {
      correlationId,
      strikeId
    });

    return successResult(data as Strike, correlationId);
  } catch (error) {
    logError('remove_strike_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to remove strike.');
  }
}

export async function getActiveStrikes(employeeId: string): Promise<Result<Strike[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.strikes.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view strikes.');
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('strikes')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('active', true)
      .order('issued_at', { ascending: false });

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    logInfo('active_strikes_read', {
      correlationId,
      employeeId,
      count: (data ?? []).length
    });

    return successResult((data ?? []) as Strike[], correlationId);
  } catch (error) {
    logError('get_active_strikes_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load strikes.');
  }
}
