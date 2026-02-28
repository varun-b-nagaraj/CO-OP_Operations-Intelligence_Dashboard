import { NormalizedScheduleResponse, ScheduleAPIResponse, ShiftChangeRequest } from '@/lib/types';

type WorkingScheduleRow = {
  date: string;
  day: string;
  period: number;
  labelKey: string;
  studentName: string;
  studentSNumber: string;
  type: string;
  group: string;
  role: string;
};

function normalizeStudentName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeScheduleResponse(raw: ScheduleAPIResponse): NormalizedScheduleResponse {
  const nameToSNumber = new Map<string, string>();
  const normalizedNameToSNumber = new Map<string, string>();
  raw.roster.forEach((entry) => {
    nameToSNumber.set(entry.name, entry.s_number);
    const normalized = normalizeStudentName(entry.name);
    if (!normalizedNameToSNumber.has(normalized)) {
      normalizedNameToSNumber.set(normalized, entry.s_number);
    }
  });

  const rows: WorkingScheduleRow[] = raw.schedule.map((assignment) => {
    const studentSNumber =
      nameToSNumber.get(assignment.Student) ??
      normalizedNameToSNumber.get(normalizeStudentName(assignment.Student));
    if (!studentSNumber) {
      throw new Error(`Schedule normalization failed: missing s_number for "${assignment.Student}"`);
    }

    const labelKey = `${assignment.Group}|${assignment.Role}|${assignment.Type}`;
    return {
      date: assignment.Date,
      day: assignment.Day,
      period: assignment.Period,
      labelKey,
      studentName: assignment.Student,
      studentSNumber,
      type: assignment.Type,
      group: assignment.Group,
      role: assignment.Role
    };
  });

  rows.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.period !== right.period) return left.period - right.period;
    if (left.labelKey !== right.labelKey) return left.labelKey.localeCompare(right.labelKey);
    const byNumber = left.studentSNumber.localeCompare(right.studentSNumber);
    if (byNumber !== 0) return byNumber;
    return left.studentName.localeCompare(right.studentName);
  });

  const slotCounters = new Map<string, number>();
  const schedule = rows.map((row) => {
    const counterKey = `${row.date}|${row.period}|${row.labelKey}`;
    const slotIndex = slotCounters.get(counterKey) ?? 0;
    slotCounters.set(counterKey, slotIndex + 1);
    const shiftSlotKey = `${row.labelKey}|${slotIndex}`;

    return {
      date: row.date,
      day: row.day,
      period: row.period,
      shiftSlotKey,
      studentName: row.studentName,
      studentSNumber: row.studentSNumber,
      type: row.type,
      group: row.group,
      role: row.role,
      effectiveWorkerSNumber: row.studentSNumber
    };
  });

  const summary = raw.summary.map((entry) => {
    const studentSNumber =
      nameToSNumber.get(entry.Student) ??
      normalizedNameToSNumber.get(normalizeStudentName(entry.Student));
    if (!studentSNumber) {
      throw new Error(
        `Schedule normalization failed: missing s_number for summary "${entry.Student}"`
      );
    }

    return {
      student: entry.Student,
      studentSNumber,
      role: entry.Role,
      group: entry.Group,
      regularShifts: entry['Regular Shifts'],
      alternateShifts: entry['Alternate Shifts'],
      totalShifts: entry['Total Shifts'],
      periodsWorked: entry['Periods Worked']
    };
  });

  return {
    meta: raw.meta,
    roster: raw.roster,
    calendar: raw.calendar,
    schedule,
    summary,
    statistics: raw.statistics.map((item) => ({
      metric: item.Metric,
      value: item.Value
    })),
    balanceAnalysis: raw.balanceAnalysis.map((item) => ({
      category: item.Category,
      metric: item.Metric,
      value: item.Value
    }))
  };
}

export function applyApprovedShiftExchanges(
  schedule: NormalizedScheduleResponse,
  exchanges: ShiftChangeRequest[]
): NormalizedScheduleResponse {
  const approvedBySlot = new Map<string, ShiftChangeRequest[]>();
  for (const exchange of exchanges) {
    if (exchange.status !== 'approved') continue;
    const slotKey = [exchange.shift_date, exchange.shift_period, exchange.shift_slot_key].join('|');
    const bucket = approvedBySlot.get(slotKey) ?? [];
    bucket.push(exchange);
    approvedBySlot.set(slotKey, bucket);
  }

  for (const bucket of approvedBySlot.values()) {
    bucket.sort((left, right) => {
      if (left.requested_at === right.requested_at) return left.id.localeCompare(right.id);
      return left.requested_at.localeCompare(right.requested_at);
    });
  }

  return {
    ...schedule,
    schedule: schedule.schedule.map((assignment) => {
      const slotKey = [assignment.date, assignment.period, assignment.shiftSlotKey].join('|');
      const slotExchanges = approvedBySlot.get(slotKey);
      if (!slotExchanges || slotExchanges.length === 0) return assignment;

      let effectiveWorker = assignment.studentSNumber;
      for (const exchange of slotExchanges) {
        if (exchange.from_employee_s_number === effectiveWorker) {
          effectiveWorker = exchange.to_employee_s_number;
        }
      }

      if (effectiveWorker === assignment.effectiveWorkerSNumber) return assignment;
      return { ...assignment, effectiveWorkerSNumber: effectiveWorker };
    })
  };
}

export function monthWindow(year: number, month: number): { from: string; to: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  };
}
