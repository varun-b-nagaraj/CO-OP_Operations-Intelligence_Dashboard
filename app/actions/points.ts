'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentById } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  errorResult,
  generateCorrelationId,
  PointType,
  PointsBreakdown,
  PointsEntry,
  Result,
  successResult
} from '@/lib/types';
import { PointsEntrySchema, sanitizeTextInput, zodFieldErrors } from '@/lib/validation';

export async function awardPoints(
  employeeId: string,
  pointType: PointType,
  points: number,
  description: string
): Promise<Result<PointsEntry>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.settings.edit');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to award points.');
    }

    const parsed = PointsEntrySchema.safeParse({
      employee_id: employeeId,
      point_type: pointType,
      points,
      description: description ? sanitizeTextInput(description) : null
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid points payload',
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
      .from('points_ledger')
      .insert({
        employee_id: parsed.data.employee_id,
        point_type: parsed.data.point_type,
        points: parsed.data.points,
        description: parsed.data.description ?? null,
        awarded_by: 'open_access'
      })
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to award points');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'points_awarded',
        tableName: 'points_ledger',
        recordId: data.id,
        oldValue: null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('points_awarded', {
      correlationId,
      employeeId,
      pointType,
      points
    });

    return successResult(data as PointsEntry, correlationId);
  } catch (error) {
    logError('award_points_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to award points.');
  }
}

export async function getPointsBreakdown(employeeId: string): Promise<Result<PointsBreakdown>> {
  const correlationId = generateCorrelationId();

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('points_ledger')
      .select('*')
      .eq('employee_id', employeeId);

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const base: PointsBreakdown = {
      total: 0,
      byType: {
        meeting: 0,
        morning_shift: 0,
        off_period_shift: 0,
        project: 0,
        manual: 0
      }
    };

    for (const entry of data ?? []) {
      const pointType = entry.point_type as PointType;
      if (!(pointType in base.byType)) continue;
      const pointsValue = Number(entry.points) || 0;
      base.byType[pointType] += pointsValue;
      base.total += pointsValue;
    }

    logInfo('points_breakdown_read', {
      correlationId,
      employeeId,
      total: base.total
    });

    return successResult(base, correlationId);
  } catch (error) {
    logError('get_points_breakdown_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load points breakdown.');
  }
}
