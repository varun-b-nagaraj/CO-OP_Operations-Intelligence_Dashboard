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

async function upsertMeetingAttendanceSourceRecord(input: {
  supabase: ReturnType<typeof createServerClient>;
  sNumber: string;
  checkinDate: string;
  manualStatus: 'present' | 'absent' | 'excused' | null;
  manualReason?: string | null;
  updatedBy?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existing, error: existingError } = await input.supabase
    .from('meeting_attendance_records')
    .select('*')
    .eq('s_number', input.sNumber)
    .eq('checkin_date', input.checkinDate)
    .maybeSingle();

  if (existingError) {
    return { ok: false, message: existingError.message };
  }

  const apiStatus =
    (existing?.api_status as 'present' | 'absent' | null | undefined) ?? 'absent';
  const effectiveStatus = input.manualStatus ?? apiStatus;

  const { error: upsertError } = await input.supabase.from('meeting_attendance_records').upsert(
    {
      s_number: input.sNumber,
      checkin_date: input.checkinDate,
      api_status: apiStatus,
      manual_status: input.manualStatus,
      effective_status: effectiveStatus,
      source: input.manualStatus ? 'manual' : 'api_sync',
      manual_reason: input.manualReason ?? null,
      last_api_synced_at: existing?.last_api_synced_at ?? null,
      updated_by: input.updatedBy ?? 'open_access'
    },
    {
      onConflict: 's_number,checkin_date'
    }
  );

  if (upsertError) {
    return { ok: false, message: upsertError.message };
  }

  return { ok: true };
}

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
      .order('overridden_at', { ascending: false });

    const existingRows = (existing ?? []) as AttendanceOverride[];
    const existingRow = existingRows[0] ?? null;

    let data: AttendanceOverride | null = null;
    let error: { message?: string } | null = null;

    if (existingRows.length > 0) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('attendance_overrides')
        .update(
          {
            override_type: parsed.data.override_type,
            reason: parsed.data.reason,
            overridden_by: 'open_access',
            overridden_at: new Date().toISOString()
          }
        )
        .eq('s_number', parsed.data.s_number)
        .eq('checkin_date', parsed.data.checkin_date)
        .eq('scope', 'meeting')
        .select('*')
        .order('overridden_at', { ascending: false });

      data = (updatedRows?.[0] as AttendanceOverride | undefined) ?? null;
      error = updateError ? { message: updateError.message } : null;
    } else {
      const { data: insertedRow, error: insertError } = await supabase
        .from('attendance_overrides')
        .insert(
          {
            s_number: parsed.data.s_number,
            checkin_date: parsed.data.checkin_date,
            scope: 'meeting',
            shift_period: null,
            override_type: parsed.data.override_type,
            reason: parsed.data.reason,
            overridden_by: 'open_access'
          }
        )
        .select('*')
        .single();

      data = insertedRow as AttendanceOverride | null;
      error = insertError ? { message: insertError.message } : null;
    }

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to save override');
    }

    const sourceUpdate = await upsertMeetingAttendanceSourceRecord({
      supabase,
      sNumber: parsed.data.s_number,
      checkinDate: parsed.data.checkin_date,
      manualStatus: parsed.data.override_type === 'present_override' ? 'present' : 'excused',
      manualReason: parsed.data.reason,
      updatedBy: 'open_access'
    });
    if (!sourceUpdate.ok) {
      return errorResult(correlationId, 'DB_ERROR', sourceUpdate.message);
    }

    await insertAuditEntry(
      supabase,
      {
        action:
          parsed.data.override_type === 'excused'
            ? 'meeting_absence_pardoned'
            : 'meeting_attendance_overridden',
        tableName: 'attendance_overrides',
        recordId: String(data.id ?? ''),
        oldValue: existingRow ?? null,
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

    return successResult(data, correlationId);
  } catch (error) {
    logError('meeting_override_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to save attendance override.');
  }
}

export async function clearMeetingOverride(
  sNumber: string,
  date: string
): Promise<Result<{ removed: number }>> {
  const correlationId = generateCorrelationId();

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
      s_number: sNumber,
      checkin_date: date,
      scope: 'meeting',
      shift_period: null,
      override_type: 'present_override',
      reason: 'clear'
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid meeting override clear payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const { data: existingRows, error: existingError } = await supabase
      .from('attendance_overrides')
      .select('*')
      .eq('s_number', sNumber)
      .eq('checkin_date', date)
      .eq('scope', 'meeting');

    if (existingError) {
      return errorResult(correlationId, 'DB_ERROR', existingError.message);
    }

    const rows = (existingRows ?? []) as AttendanceOverride[];
    if (rows.length === 0) {
      return successResult({ removed: 0 }, correlationId);
    }

    const ids = rows.map((row) => row.id);
    const { error: deleteError } = await supabase.from('attendance_overrides').delete().in('id', ids);
    if (deleteError) {
      return errorResult(correlationId, 'DB_ERROR', deleteError.message);
    }

    const sourceUpdate = await upsertMeetingAttendanceSourceRecord({
      supabase,
      sNumber,
      checkinDate: date,
      manualStatus: null,
      manualReason: null,
      updatedBy: 'open_access'
    });
    if (!sourceUpdate.ok) {
      return errorResult(correlationId, 'DB_ERROR', sourceUpdate.message);
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'meeting_override_cleared',
        tableName: 'attendance_overrides',
        recordId: `${sNumber}:${date}`,
        oldValue: rows,
        newValue: null,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('meeting_override_cleared', {
      correlationId,
      sNumber,
      date,
      removed: ids.length
    });

    return successResult({ removed: ids.length }, correlationId);
  } catch (error) {
    logError('clear_meeting_override_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to clear meeting override.');
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

export async function markMeetingAbsent(
  sNumber: string,
  date: string,
  reason: string
): Promise<Result<{ removed: number }>> {
  const correlationId = generateCorrelationId();

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
      s_number: sNumber,
      checkin_date: date,
      scope: 'meeting',
      shift_period: null,
      override_type: 'excused',
      reason: reason.trim() || 'Marked absent from attendance table'
    });
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid meeting absent payload',
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

    const { data: existingAttendance, error: existingAttendanceError } = await supabase
      .from('attendance')
      .select('*')
      .eq('s_number', parsed.data.s_number)
      .eq('checkin_date', parsed.data.checkin_date)
      .maybeSingle();
    if (existingAttendanceError) {
      return errorResult(correlationId, 'DB_ERROR', existingAttendanceError.message);
    }

    const { error: deleteAttendanceError } = await supabase
      .from('attendance')
      .delete()
      .eq('s_number', parsed.data.s_number)
      .eq('checkin_date', parsed.data.checkin_date);
    if (deleteAttendanceError) {
      return errorResult(correlationId, 'DB_ERROR', deleteAttendanceError.message);
    }

    const { error: clearOverridesError } = await supabase
      .from('attendance_overrides')
      .delete()
      .eq('s_number', parsed.data.s_number)
      .eq('checkin_date', parsed.data.checkin_date)
      .eq('scope', 'meeting');
    if (clearOverridesError) {
      return errorResult(correlationId, 'DB_ERROR', clearOverridesError.message);
    }

    const sourceUpdate = await upsertMeetingAttendanceSourceRecord({
      supabase,
      sNumber: parsed.data.s_number,
      checkinDate: parsed.data.checkin_date,
      manualStatus: 'absent',
      manualReason: parsed.data.reason,
      updatedBy: 'open_access'
    });
    if (!sourceUpdate.ok) {
      return errorResult(correlationId, 'DB_ERROR', sourceUpdate.message);
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'meeting_marked_absent',
        tableName: 'attendance',
        recordId: `${parsed.data.s_number}:${parsed.data.checkin_date}`,
        oldValue: existingAttendance ?? null,
        newValue: { removed: existingAttendance ? 1 : 0, reason: parsed.data.reason },
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('meeting_marked_absent', {
      correlationId,
      sNumber: parsed.data.s_number,
      checkinDate: parsed.data.checkin_date,
      removed: existingAttendance ? 1 : 0
    });

    return successResult({ removed: existingAttendance ? 1 : 0 }, correlationId);
  } catch (error) {
    logError('mark_meeting_absent_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to mark meeting absent.');
  }
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
