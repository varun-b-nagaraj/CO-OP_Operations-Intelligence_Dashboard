'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentBySNumber } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  AttendanceOverride,
  errorResult,
  generateCorrelationId,
  Result,
  successResult
} from '@/lib/types';
import { AttendanceOverrideSchema, zodFieldErrors } from '@/lib/validation';

async function upsertMeetingOverride(
  payload: {
    s_number: string;
    checkin_date: string;
    override_type: 'excused' | 'present_override';
    reason: string;
  },
  correlationId: string
): Promise<Result<AttendanceOverride>> {
  try {
    const allowed = await ensureServerPermission('hr.attendance.override');
    if (!allowed) {
      return errorResult(
        correlationId,
        'FORBIDDEN',
        'You do not have permission to override attendance.'
      );
    }

    const parsed = AttendanceOverrideSchema.safeParse({
      ...payload,
      scope: 'meeting',
      shift_period: null
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid attendance override payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const student = await getStudentBySNumber(supabase, parsed.data.s_number);
    if (!student) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Employee does not exist', {
        s_number: 's_number was not found in students table'
      });
    }

    const { data: existing } = await supabase
      .from('attendance_overrides')
      .select('*')
      .eq('s_number', parsed.data.s_number)
      .eq('checkin_date', parsed.data.checkin_date)
      .eq('scope', 'meeting')
      .maybeSingle();

    const { data, error } = await supabase
      .from('attendance_overrides')
      .upsert(
        {
          s_number: parsed.data.s_number,
          checkin_date: parsed.data.checkin_date,
          scope: 'meeting',
          shift_period: null,
          override_type: parsed.data.override_type,
          reason: parsed.data.reason,
          overridden_by: 'open_access'
        },
        {
          onConflict: 's_number,checkin_date,scope'
        }
      )
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to save override');
    }

    await insertAuditEntry(
      supabase,
      {
        action:
          parsed.data.override_type === 'excused'
            ? 'meeting_absence_pardoned'
            : 'meeting_attendance_overridden',
        tableName: 'attendance_overrides',
        recordId: data.id,
        oldValue: existing ?? null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('meeting_override_upserted', {
      correlationId,
      sNumber: parsed.data.s_number,
      checkinDate: parsed.data.checkin_date,
      overrideType: parsed.data.override_type
    });

    return successResult(data as AttendanceOverride, correlationId);
  } catch (error) {
    logError('meeting_override_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to save attendance override.');
  }
}

export async function pardonMeetingAbsence(
  sNumber: string,
  date: string,
  reason: string
): Promise<Result<AttendanceOverride>> {
  return upsertMeetingOverride(
    {
      s_number: sNumber,
      checkin_date: date,
      override_type: 'excused',
      reason
    },
    generateCorrelationId()
  );
}

export async function overrideMeetingAttendance(
  sNumber: string,
  date: string,
  reason: string
): Promise<Result<AttendanceOverride>> {
  return upsertMeetingOverride(
    {
      s_number: sNumber,
      checkin_date: date,
      override_type: 'present_override',
      reason
    },
    generateCorrelationId()
  );
}

export async function getAttendanceOverrides(
  sNumber: string,
  scope: 'meeting' | 'shift'
): Promise<Result<AttendanceOverride[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.attendance.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view attendance.');
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('attendance_overrides')
      .select('*')
      .eq('s_number', sNumber)
      .eq('scope', scope)
      .order('checkin_date', { ascending: false });

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    logInfo('attendance_overrides_read', {
      correlationId,
      sNumber,
      scope,
      rows: (data ?? []).length
    });

    return successResult((data ?? []) as AttendanceOverride[], correlationId);
  } catch (error) {
    logError('get_attendance_overrides_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load attendance overrides.');
  }
}
