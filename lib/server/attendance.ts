import { AttendanceOverride, MeetingAttendanceRecord, MeetingAttendanceResponse } from '@/lib/types';

function resolveOverrideByDate(overrides: AttendanceOverride[]): Map<string, 'excused' | 'present_override'> {
  const map = new Map<string, 'excused' | 'present_override'>();

  for (const override of overrides) {
    if (override.scope !== 'meeting') continue;
    const existing = map.get(override.checkin_date);
    if (!existing) {
      map.set(override.checkin_date, override.override_type);
      continue;
    }

    if (existing === override.override_type) continue;
    map.set(
      override.checkin_date,
      existing === 'present_override' || override.override_type === 'present_override'
        ? 'present_override'
        : 'excused'
    );
  }

  return map;
}

function resolveShiftOverrideByDatePeriod(
  overrides: AttendanceOverride[]
): Map<string, 'excused' | 'present_override'> {
  const map = new Map<string, 'excused' | 'present_override'>();

  for (const override of overrides) {
    if (override.scope !== 'shift') continue;
    if (typeof override.shift_period !== 'number') continue;
    const key = `${override.checkin_date}|${override.shift_period}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, override.override_type);
      continue;
    }

    if (existing === override.override_type) continue;
    map.set(
      key,
      existing === 'present_override' || override.override_type === 'present_override'
        ? 'present_override'
        : 'excused'
    );
  }

  return map;
}

export function calculateMeetingAttendanceRate(inputs: {
  attendanceRecords: Array<{ date: string; status: 'present' | 'absent' }>;
  overrides: AttendanceOverride[];
}): {
  raw_rate: number | null;
  adjusted_rate: number | null;
  total_sessions: number;
  attended: number;
  excused: number;
} {
  const total_sessions = inputs.attendanceRecords.length;
  if (total_sessions === 0) {
    return { raw_rate: null, adjusted_rate: null, total_sessions: 0, attended: 0, excused: 0 };
  }

  const overrideByDate = resolveOverrideByDate(inputs.overrides);
  let rawAttended = 0;
  let adjustedAttended = 0;
  let excused = 0;

  for (const session of inputs.attendanceRecords) {
    const override = overrideByDate.get(session.date);
    if (override === 'present_override') {
      rawAttended += 1;
      adjustedAttended += 1;
      continue;
    }
    if (override === 'excused') {
      rawAttended += session.status === 'present' ? 1 : 0;
      excused += 1;
      continue;
    }
    if (session.status === 'present') {
      rawAttended += 1;
      adjustedAttended += 1;
    }
  }

  const raw_rate = (rawAttended / total_sessions) * 100;
  const adjustedDenominator = total_sessions - excused;
  const adjusted_rate =
    adjustedDenominator <= 0 ? null : (adjustedAttended / adjustedDenominator) * 100;

  return { raw_rate, adjusted_rate, total_sessions, attended: adjustedAttended, excused };
}

export function calculateShiftAttendanceRate(inputs: {
  shiftAttendanceRecords: Array<{
    status: 'expected' | 'present' | 'absent' | 'excused';
    rawStatus?: 'expected' | 'present' | 'absent' | 'excused' | null;
    date?: string | null;
    shiftPeriod?: number | null;
  }>;
  overrides?: AttendanceOverride[];
}): {
  raw_rate: number | null;
  adjusted_rate: number | null;
  expected_shifts: number;
  attended: number;
  excused: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const eligibleRecords = inputs.shiftAttendanceRecords.filter((item) => {
    if (!item.date) return true;
    return item.date <= today;
  });
  const shiftOverrideByDatePeriod = resolveShiftOverrideByDatePeriod(inputs.overrides ?? []);

  const expected_shifts = eligibleRecords.length;
  if (expected_shifts === 0) {
    return { raw_rate: null, adjusted_rate: null, expected_shifts: 0, attended: 0, excused: 0 };
  }

  const rawAttended = eligibleRecords.filter((item) => {
    const status = item.rawStatus ?? item.status;
    return status === 'present';
  }).length;
  const attended = eligibleRecords.filter((item) => {
    const key = `${String(item.date ?? '')}|${Number(item.shiftPeriod ?? -1)}`;
    const overrideType = shiftOverrideByDatePeriod.get(key);
    if (overrideType === 'present_override') return true;
    if (overrideType === 'excused') return false;
    return item.status === 'present';
  }).length;
  const excused = eligibleRecords.filter((item) => {
    const key = `${String(item.date ?? '')}|${Number(item.shiftPeriod ?? -1)}`;
    const overrideType = shiftOverrideByDatePeriod.get(key);
    if (overrideType === 'excused') return true;
    if (overrideType === 'present_override') return false;
    return item.status === 'excused';
  }).length;
  const raw_rate = (rawAttended / expected_shifts) * 100;
  const adjustedDenominator = expected_shifts - excused;
  const adjusted_rate = adjustedDenominator <= 0 ? null : (attended / adjustedDenominator) * 100;

  return { raw_rate, adjusted_rate, expected_shifts, attended, excused };
}

export function summarizeShiftAttendanceCounts(inputs: {
  shiftAttendanceRecords: Array<{
    status: 'expected' | 'present' | 'absent' | 'excused';
    date?: string | null;
    shiftPeriod?: number | null;
  }>;
  throughTodayOnly?: boolean;
  overrides?: AttendanceOverride[];
}): {
  scheduled: number;
  expected: number;
  present: number;
  absent: number;
  excused: number;
  morningPresent: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const eligibleRecords = inputs.throughTodayOnly
    ? inputs.shiftAttendanceRecords.filter((item) => {
        if (!item.date) return true;
        return item.date <= today;
      })
    : inputs.shiftAttendanceRecords;
  const shiftOverrideByDatePeriod = resolveShiftOverrideByDatePeriod(inputs.overrides ?? []);

  const resolvedStatus = (
    item: (typeof eligibleRecords)[number]
  ): 'expected' | 'present' | 'absent' | 'excused' => {
    const key = `${String(item.date ?? '')}|${Number(item.shiftPeriod ?? -1)}`;
    const overrideType = shiftOverrideByDatePeriod.get(key);
    if (overrideType === 'present_override') return 'present';
    if (overrideType === 'excused') return 'excused';
    return item.status;
  };

  return {
    scheduled: eligibleRecords.length,
    expected: eligibleRecords.filter((item) => resolvedStatus(item) === 'expected').length,
    present: eligibleRecords.filter((item) => resolvedStatus(item) === 'present').length,
    absent: eligibleRecords.filter((item) => resolvedStatus(item) === 'absent').length,
    excused: eligibleRecords.filter((item) => resolvedStatus(item) === 'excused').length,
    morningPresent: eligibleRecords.filter(
      (item) => resolvedStatus(item) === 'present' && Number(item.shiftPeriod ?? -1) === 0
    ).length
  };
}

export function extractMeetingAttendanceRecords(payload: Record<string, unknown>): MeetingAttendanceRecord[] {
  const rows = payload.attendance_rows ?? payload.attendance ?? payload.records;
  if (Array.isArray(rows)) {
    const parsed = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const record = row as Record<string, unknown>;
        const s_number = record.s_number;
        const date = record.date ?? record.checkin_date;
        const status = record.status;
        if (typeof s_number !== 'string' || typeof date !== 'string') return null;
        if (status !== 'present' && status !== 'absent') return null;
        return { s_number, date, status };
      })
      .filter((value): value is MeetingAttendanceRecord => Boolean(value));

    if (parsed.length > 0) return parsed;
  }

  const dates = Array.isArray(payload.dates)
    ? payload.dates.filter((item): item is string => typeof item === 'string')
    : [];
  const students =
    payload.analytics &&
    typeof payload.analytics === 'object' &&
    Array.isArray((payload.analytics as Record<string, unknown>).students)
      ? ((payload.analytics as Record<string, unknown>).students as Array<Record<string, unknown>>)
      : [];

  if (dates.length === 0 || students.length === 0) return [];

  const generated: MeetingAttendanceRecord[] = [];
  for (const student of students) {
    const s_number = typeof student.s_number === 'string' ? student.s_number : undefined;
    const present_count =
      typeof student.present_count === 'number' && Number.isFinite(student.present_count)
        ? Math.max(0, Math.floor(student.present_count))
        : 0;
    const absent_count =
      typeof student.absent_count === 'number' && Number.isFinite(student.absent_count)
        ? Math.max(0, Math.floor(student.absent_count))
        : Math.max(0, dates.length - present_count);

    if (!s_number) continue;

    const statusList: Array<'present' | 'absent'> = [
      ...Array(Math.min(present_count, dates.length)).fill('present'),
      ...Array(Math.min(absent_count, Math.max(0, dates.length - present_count))).fill('absent')
    ];

    while (statusList.length < dates.length) statusList.push('absent');

    for (let index = 0; index < dates.length; index += 1) {
      generated.push({
        s_number,
        date: dates[index],
        status: statusList[index]
      });
    }
  }

  return generated;
}

export function applyMeetingOverrides(
  data: MeetingAttendanceResponse,
  overrides: AttendanceOverride[]
): MeetingAttendanceResponse {
  const overrideLookup = new Map<string, AttendanceOverride['override_type']>();
  for (const override of overrides) {
    if (override.scope !== 'meeting') continue;
    const key = `${override.s_number}|${override.checkin_date}`;
    const existing = overrideLookup.get(key);
    if (!existing || override.override_type === 'present_override') {
      overrideLookup.set(key, override.override_type);
    }
  }

  const recordsByStudent = new Map<string, Array<{ date: string; status: 'present' | 'absent' }>>();
  for (const record of data.records) {
    const bucket = recordsByStudent.get(record.s_number) ?? [];
    bucket.push({ date: record.date, status: record.status });
    recordsByStudent.set(record.s_number, bucket);
  }

  const updatedStudents = data.analytics.students.map((student) => {
    const studentRecords = recordsByStudent.get(student.s_number) ?? [];
    const studentOverrides = overrides.filter(
      (override) => override.scope === 'meeting' && override.s_number === student.s_number
    );

    const rates = calculateMeetingAttendanceRate({
      attendanceRecords: studentRecords,
      overrides: studentOverrides
    });

    const recalculatedPresent = studentRecords.reduce((accumulator, record) => {
      const overrideType = overrideLookup.get(`${student.s_number}|${record.date}`);
      if (overrideType === 'present_override') return accumulator + 1;
      if (overrideType === 'excused') return accumulator;
      return accumulator + (record.status === 'present' ? 1 : 0);
    }, 0);

    const recalculatedAbsent = Math.max(0, rates.total_sessions - recalculatedPresent - rates.excused);
    return {
      ...student,
      present_count: rates.total_sessions === 0 ? student.present_count : recalculatedPresent,
      absent_count: rates.total_sessions === 0 ? student.absent_count : recalculatedAbsent,
      attendance_rate: rates.raw_rate ?? student.attendance_rate,
      raw_attendance_rate: rates.raw_rate,
      adjusted_attendance_rate: rates.adjusted_rate,
      excused_count: rates.excused
    };
  });

  const totalSessions = data.analytics.total_sessions;
  const averageAttendance =
    updatedStudents.length === 0
      ? data.analytics.avg_attendance
      : updatedStudents.reduce((sum, student) => sum + (student.raw_attendance_rate ?? 0), 0) /
        updatedStudents.length;

  return {
    ...data,
    analytics: {
      ...data.analytics,
      total_sessions: totalSessions,
      avg_attendance: averageAttendance,
      students: updatedStudents
    }
  };
}
