import { NextRequest } from 'next/server';

import { getCorrelationId, jsonResult, jsonValidationError, logError, logInfo } from '@/lib/server/common';
import { fetchMeetingAttendanceFromApi } from '@/lib/server/external-apis';
import { AttendanceOverride, MeetingAttendanceResponse, errorResult, successResult } from '@/lib/types';
import { MeetingAttendanceParamsSchema, zodFieldErrors } from '@/lib/validation';
import { createServerClient } from '@/lib/supabase';

type ApiStatus = 'present' | 'absent';
type EffectiveStatus = 'present' | 'absent' | 'excused';

function resolveOverrideLookup(
  overrides: AttendanceOverride[]
): Map<string, 'excused' | 'present_override'> {
  const map = new Map<string, 'excused' | 'present_override'>();
  for (const row of overrides) {
    if (row.scope !== 'meeting') continue;
    const key = `${row.s_number}|${row.checkin_date}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row.override_type);
      continue;
    }
    if (existing === row.override_type) continue;
    map.set(
      key,
      existing === 'present_override' || row.override_type === 'present_override'
        ? 'present_override'
        : 'excused'
    );
  }
  return map;
}

function resolveEffectiveStatus(input: {
  apiStatus: ApiStatus;
  manualStatus: EffectiveStatus | null;
  overrideType: 'excused' | 'present_override' | null;
}): EffectiveStatus {
  if (input.manualStatus) return input.manualStatus;
  if (input.overrideType === 'present_override') return 'present';
  if (input.overrideType === 'excused') return 'excused';
  return input.apiStatus;
}

function buildMeetingView(input: {
  source: {
    ok: boolean;
    dates: string[];
    meta: MeetingAttendanceResponse['meta'];
    roster: Array<{ name: string; s_number: string }>;
  };
  rows: Array<{
    s_number: string;
    checkin_date: string;
    effective_status: EffectiveStatus;
  }>;
}): MeetingAttendanceResponse {
  const rowByKey = new Map<string, { s_number: string; checkin_date: string; effective_status: EffectiveStatus }>(
    input.rows.map((row) => [`${row.s_number}|${row.checkin_date}`, row] as const)
  );

  const records: MeetingAttendanceResponse['records'] = [];
  for (const student of input.source.roster) {
    for (const date of input.source.dates) {
      const key = `${student.s_number}|${date}`;
      const row = rowByKey.get(key);
      const effectiveStatus = row?.effective_status ?? 'absent';
      records.push({
        s_number: student.s_number,
        date,
        status: effectiveStatus === 'present' ? 'present' : 'absent'
      });
    }
  }

  const students = input.source.roster.map((student) => {
    const studentRows = input.rows.filter((row) => row.s_number === student.s_number);
    const total = studentRows.length;
    const presentCount = studentRows.filter((row) => row.effective_status === 'present').length;
    const excusedCount = studentRows.filter((row) => row.effective_status === 'excused').length;
    const absentCount = Math.max(0, total - presentCount - excusedCount);
    const rawRate = total === 0 ? null : (presentCount / total) * 100;
    const adjustedDenominator = total - excusedCount;
    const adjustedRate = adjustedDenominator <= 0 ? null : (presentCount / adjustedDenominator) * 100;

    return {
      name: student.name,
      s_number: student.s_number,
      present_count: presentCount,
      absent_count: absentCount,
      attendance_rate: rawRate ?? 0,
      raw_attendance_rate: rawRate,
      adjusted_attendance_rate: adjustedRate,
      excused_count: excusedCount
    };
  });

  const sessions = input.source.dates.map((date) => {
    const sessionRows = input.rows.filter((row) => row.checkin_date === date);
    const presentCount = sessionRows.filter((row) => row.effective_status === 'present').length;
    const total = sessionRows.length;
    const absentCount = Math.max(0, total - presentCount);
    const attendanceRate = total === 0 ? 0 : (presentCount / total) * 100;
    return {
      date,
      present_count: presentCount,
      absent_count: absentCount,
      total_students: total,
      attendance_rate: attendanceRate
    };
  });

  const avgAttendance =
    students.length === 0
      ? 0
      : students.reduce((sum, student) => sum + (student.raw_attendance_rate ?? 0), 0) /
        students.length;

  return {
    ok: input.source.ok,
    dates: input.source.dates,
    meta: input.source.meta,
    roster: input.source.roster,
    records,
    sessions,
    analytics: {
      total_students: input.source.roster.length,
      total_sessions: input.source.dates.length,
      avg_attendance: avgAttendance,
      students
    }
  };
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request.headers.get('x-correlation-id'));

  try {
    const rawParams = {
      date: request.nextUrl.searchParams.get('date') ?? undefined,
      from: request.nextUrl.searchParams.get('from') ?? undefined,
      to: request.nextUrl.searchParams.get('to') ?? undefined,
      exclude: request.nextUrl.searchParams.get('exclude') ?? undefined
    };

    const parsed = MeetingAttendanceParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return jsonValidationError(
        correlationId,
        'Invalid meeting attendance parameters',
        zodFieldErrors(parsed.error)
      );
    }

    const meetingData = await fetchMeetingAttendanceFromApi(parsed.data, correlationId);
    const supabase = createServerClient();

    const from = parsed.data.date ?? parsed.data.from;
    const to = parsed.data.date ?? parsed.data.to ?? parsed.data.from;
    const dates = meetingData.dates ?? [];
    const roster =
      meetingData.roster.length > 0
        ? meetingData.roster
        : meetingData.analytics.students.map((student) => ({
            name: student.name,
            s_number: student.s_number
          }));

    let overridesQuery = supabase.from('attendance_overrides').select('*').eq('scope', 'meeting');
    if (from) overridesQuery = overridesQuery.gte('checkin_date', from);
    if (to) overridesQuery = overridesQuery.lte('checkin_date', to);
    const { data: overrides, error: overrideError } = await overridesQuery;
    if (overrideError) {
      return jsonResult(errorResult(correlationId, 'DB_ERROR', overrideError.message), 500);
    }
    const overrideByKey = resolveOverrideLookup((overrides ?? []) as AttendanceOverride[]);

    const apiStatusByKey = new Map<string, ApiStatus>();
    for (const record of meetingData.records) {
      apiStatusByKey.set(`${record.s_number}|${record.date}`, record.status);
    }

    let existingQuery = supabase.from('meeting_attendance_records').select('*');
    if (from) existingQuery = existingQuery.gte('checkin_date', from);
    if (to) existingQuery = existingQuery.lte('checkin_date', to);
    if (roster.length > 0) {
      existingQuery = existingQuery.in(
        's_number',
        Array.from(new Set(roster.map((item) => item.s_number)))
      );
    }
    const { data: existingRows, error: existingError } = await existingQuery;
    if (existingError) {
      return jsonResult(errorResult(correlationId, 'DB_ERROR', existingError.message), 500);
    }
    const existingByKey = new Map(
      ((existingRows ?? []) as Array<Record<string, unknown>>).map((row) => [
        `${String(row.s_number ?? '')}|${String(row.checkin_date ?? '')}`,
        row
      ])
    );

    const nowIso = new Date().toISOString();
    const rowsToUpsert: Array<Record<string, unknown>> = [];
    for (const student of roster) {
      for (const date of dates) {
        const key = `${student.s_number}|${date}`;
        const existing = existingByKey.get(key);
        const apiStatus = (apiStatusByKey.get(key) ?? 'absent') as ApiStatus;
        const manualStatus = (existing?.manual_status as EffectiveStatus | null | undefined) ?? null;
        const overrideType = overrideByKey.get(key) ?? null;
        const effectiveStatus = resolveEffectiveStatus({
          apiStatus,
          manualStatus,
          overrideType
        });

        rowsToUpsert.push({
          s_number: student.s_number,
          checkin_date: date,
          api_status: apiStatus,
          manual_status: manualStatus,
          effective_status: effectiveStatus,
          source: manualStatus ? 'manual' : 'api_sync',
          manual_reason: (existing?.manual_reason as string | null | undefined) ?? null,
          last_api_synced_at: nowIso,
          updated_by: manualStatus ? (existing?.updated_by as string | null | undefined) ?? 'open_access' : 'api_sync'
        });
      }
    }

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase.from('meeting_attendance_records').upsert(rowsToUpsert, {
        onConflict: 's_number,checkin_date'
      });
      if (upsertError) {
        return jsonResult(errorResult(correlationId, 'DB_ERROR', upsertError.message), 500);
      }
    }

    let mergedRowsQuery = supabase
      .from('meeting_attendance_records')
      .select('s_number, checkin_date, effective_status');
    if (from) mergedRowsQuery = mergedRowsQuery.gte('checkin_date', from);
    if (to) mergedRowsQuery = mergedRowsQuery.lte('checkin_date', to);
    if (roster.length > 0) {
      mergedRowsQuery = mergedRowsQuery.in(
        's_number',
        Array.from(new Set(roster.map((item) => item.s_number)))
      );
    }
    const { data: mergedRows, error: mergedError } = await mergedRowsQuery;
    if (mergedError) {
      return jsonResult(errorResult(correlationId, 'DB_ERROR', mergedError.message), 500);
    }

    const response = buildMeetingView({
      source: {
        ok: meetingData.ok,
        dates,
        meta: meetingData.meta,
        roster
      },
      rows: (mergedRows ?? []) as Array<{
        s_number: string;
        checkin_date: string;
        effective_status: EffectiveStatus;
      }>
    });

    logInfo('meeting_proxy_success', {
      correlationId,
      sessions: response.analytics.total_sessions,
      students: response.analytics.total_students
    });

    return jsonResult(successResult(response, correlationId), 200);
  } catch (error) {
    logError('meeting_proxy_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonResult(
      errorResult(
        correlationId,
        'EXTERNAL_API_ERROR',
        'Unable to fetch meeting attendance data. Please try again.'
      ),
      500
    );
  }
}
