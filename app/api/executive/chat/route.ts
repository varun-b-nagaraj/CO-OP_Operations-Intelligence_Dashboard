import { NextRequest, NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import {
  detectShiftScope,
  getToolSpecById,
  isAttendancePrecisionPrompt,
  isGreetingPrompt,
  isOperationalDataPrompt,
  isToolListingPrompt,
  requiresFreshDataPrompt,
  ShiftScope
} from '@/lib/executive/tooling';
import {
  getLatestAssistantMessageState,
  getUserMemoryFacts,
  insertConversationMessage,
  listRecentConversationContext,
  resolveUserKey,
  upsertUserMemoryFacts
} from '@/lib/server/executive-memory';
import {
  ExecutiveOverviewData,
  ExecutiveToolTraceItem,
  runExecutiveTooling
} from '@/lib/server/executive';
import { proxyOllamaChatRequest } from '@/lib/server/ollama-proxy';
import {
  AnswerProvenance,
  QueryPlan,
  ToolCatalogEntry,
  ToolExecutionRecord,
  ToolQueryFilter,
  ValidationResult
} from '@/lib/executive/tool-query';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MemoryFactCandidate {
  factText: string;
  category: string;
  importance: number;
}

interface ToolingCachePayload {
  generatedAt: string;
  toolContext: string;
  overview: ExecutiveOverviewData;
  toolTrace: ExecutiveToolTraceItem[];
  toolCatalog?: ToolCatalogEntry[];
  queryPlan?: QueryPlan;
  executionRecords?: ToolExecutionRecord[];
}

function isScheduleRosterPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes('schedule') ||
    normalized.includes('scheduled') ||
    normalized.includes('who is working') ||
    normalized.includes("who's working") ||
    normalized.includes('work tomorrow') ||
    normalized.includes('tomorrow')
  );
}

function buildScheduleAssistantReply(message: string, overview: ExecutiveOverviewData): string {
  const schedule = overview.tomorrowSchedule;
  if (!schedule) {
    return 'Schedule data is missing from this tool run. I can rerun and return tomorrow roster details.';
  }

  if (!schedule.workers.length) {
    return `No scheduled workers were found for ${schedule.date} in the shift schedule dataset.`;
  }

  const uniqueWorkers = Array.from(new Map(schedule.workers.map((worker) => [worker.sNumber, worker])).values());
  const alternateWorkers = Array.from(
    new Map(
      schedule.workers.filter((worker) => worker.isAlternate).map((worker) => [worker.sNumber, worker])
    ).values()
  );
  const workerList = uniqueWorkers
    .slice(0, 40)
    .map((worker) => `${worker.name} (P${worker.period})`)
    .join(', ');
  const alternateList = alternateWorkers
    .slice(0, 20)
    .map((worker) => `${worker.name} (P${worker.period})`)
    .join(', ');

  const asksAlternate = /\balternate\b|\balt\b/.test(message.toLowerCase());
  if (asksAlternate) {
    if (!alternateWorkers.length) {
      return `No alternate workers are flagged in the schedule rows for ${schedule.date}.`;
    }
    return `Alternates on ${schedule.date}: ${alternateList}. Total alternates: ${alternateWorkers.length}.`;
  }

  const asksWho = /\bwho\b/.test(message.toLowerCase());
  if (asksWho) {
    return `Scheduled to work on ${schedule.date}: ${workerList}. Total scheduled workers: ${uniqueWorkers.length}.`;
  }

  return `Tomorrow's schedule (${schedule.date}) has ${uniqueWorkers.length} workers: ${workerList}.`;
}

function isMorningMeetingPrompt(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('morning meeting') || normalized.includes('meeting attendance');
}

function isShiftAttendancePrompt(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('shift') || normalized.includes('shift attendance');
}

function resolveRequestedShiftScope(message: string): ShiftScope {
  if (!isShiftAttendancePrompt(message)) return 'none';
  return detectShiftScope(message);
}

function isTopMorningShiftPrompt(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('most morning shifts') ||
    normalized.includes('most off period shifts') ||
    normalized.includes('most off-period shifts') ||
    normalized.includes('most shifts') ||
    normalized.includes('worked the most morning shifts') ||
    normalized.includes('worked the most off period shifts') ||
    normalized.includes('worked the most off-period shifts') ||
    (normalized.includes('shift') && normalized.includes('who') && normalized.includes('most'))
  );
}

function isDateOnOrBeforeToday(dateText: string): boolean {
  const normalized = dateText.trim();
  const dateOnly = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return true;
  const today = new Date().toISOString().slice(0, 10);
  return dateOnly <= today;
}

function selectPreferredAttendanceRecords(
  records: ToolExecutionRecord[],
  preferredTables: string[],
  fallbackTables: string[]
): ToolExecutionRecord[] {
  const preferred = records.filter(
    (record) => Boolean(record.table) && preferredTables.includes(record.table as string)
  );
  const preferredHasRows = preferred.some((record) => record.rows.length > 0);
  if (preferredHasRows) return preferred;
  return records.filter(
    (record) => Boolean(record.table) && [...preferredTables, ...fallbackTables].includes(record.table as string)
  );
}

function buildStudentDirectory(records: ToolExecutionRecord[]): Map<string, string> {
  const studentBySNumber = new Map<string, string>();
  for (const record of records) {
    if (record.table !== 'students') continue;
    for (const row of record.rows) {
      const sNumberRaw = row.s_number ?? row.student_number;
      const sNumber = typeof sNumberRaw === 'string' ? sNumberRaw.trim() : '';
      if (!sNumber) continue;
      const nameCandidates = [row.name, row.full_name, row.student_name];
      const first = typeof row.first_name === 'string' ? row.first_name.trim() : '';
      const last = typeof row.last_name === 'string' ? row.last_name.trim() : '';
      const joined = `${first} ${last}`.trim();
      const bestName =
        nameCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) ??
        (joined || '');
      if (!bestName) continue;
      studentBySNumber.set(sNumber, String(bestName).trim());
    }
  }
  return studentBySNumber;
}

function resolveDisplayName(studentBySNumber: Map<string, string>, sNumber: string): string {
  return studentBySNumber.get(sNumber) ?? 'Unknown employee';
}

function buildMorningMeetingOverviewFromRecords(records: ToolExecutionRecord[]): string | null {
  const scopedRecords = selectPreferredAttendanceRecords(
    records,
    ['hr_meeting_attendance_records'],
    ['meeting_attendance_records']
  );
  const attendanceTables = new Set(['hr_meeting_attendance_records', 'meeting_attendance_records']);
  const attendanceRows: Array<{ sNumber: string; date: string; status: string }> = [];
  const studentBySNumber = buildStudentDirectory(records);

  for (const record of scopedRecords) {
    if (!record.table) continue;
    if (attendanceTables.has(record.table)) {
      for (const row of record.rows) {
        const sNumberRaw = row.s_number ?? row.employee_s_number ?? row.student_number;
        const dateRaw = row.checkin_date ?? row.date ?? row.shift_date;
        const statusRaw = row.effective_status ?? row.status;
        const sNumber = typeof sNumberRaw === 'string' ? sNumberRaw.trim() : '';
        const date = typeof dateRaw === 'string' ? dateRaw.trim() : '';
        const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : '';
        if (!sNumber || !date) continue;
        if (!isDateOnOrBeforeToday(date)) continue;
        attendanceRows.push({ sNumber, date, status });
      }
    }
  }

  if (!attendanceRows.length) return null;

  const deduped = new Map<string, { sNumber: string; date: string; status: string }>();
  for (const row of attendanceRows) {
    const key = `${row.sNumber}|${row.date}|${row.status}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }

  const rows = Array.from(deduped.values());
  const latestDate = rows.map((row) => row.date).sort().at(-1) ?? '';
  const latestRows = latestDate ? rows.filter((row) => row.date === latestDate) : [];
  const latestPresentExcused = latestRows.filter((row) => row.status === 'present' || row.status === 'excused').length;

  const aggregate = new Map<string, { total: number; presentExcused: number }>();
  for (const row of rows) {
    const current = aggregate.get(row.sNumber) ?? { total: 0, presentExcused: 0 };
    current.total += 1;
    if (row.status === 'present' || row.status === 'excused') current.presentExcused += 1;
    aggregate.set(row.sNumber, current);
  }

  const minMeetingsForFlag = 3;
  const rollup = Array.from(aggregate.entries())
    .map(([sNumber, stat]) => {
      const rate = stat.total > 0 ? (stat.presentExcused / stat.total) * 100 : 0;
      return {
        sNumber,
        name: resolveDisplayName(studentBySNumber, sNumber),
        total: stat.total,
        presentExcused: stat.presentExcused,
        rate
      };
    })
    .filter((row) => row.total >= minMeetingsForFlag);

  const below50 = rollup
    .filter((row) => row.rate < 50)
    .sort((a, b) => a.rate - b.rate || b.total - a.total || a.name.localeCompare(b.name));
  const below70 = rollup
    .filter((row) => row.rate < 70)
    .sort((a, b) => a.rate - b.rate || b.total - a.total || a.name.localeCompare(b.name));

  const fmt = (rowsToFormat: typeof below70) =>
    rowsToFormat.slice(0, 60).map((row) => `${row.name} (${Math.round(row.rate)}%, ${row.presentExcused}/${row.total})`).join('; ');

  return [
    `Morning meeting overview (${latestDate || 'latest date unavailable'}): ${latestPresentExcused}/${latestRows.length} present/excused.`,
    `Below 50% attendance (min ${minMeetingsForFlag} meetings): ${below50.length ? fmt(below50) : 'none'}.`,
    `Below 70% attendance (min ${minMeetingsForFlag} meetings): ${below70.length ? fmt(below70) : 'none'}.`
  ].join(' ');
}

function wantsMeetingByMeetingBreakdown(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('meeting by meeting') ||
    normalized.includes('each meeting') ||
    normalized.includes('by date') ||
    normalized.includes('date-wise') ||
    normalized.includes('breakdown') ||
    normalized.includes('how many meetings') ||
    normalized.includes('this year') ||
    normalized.includes('since ')
  );
}

function buildMeetingByMeetingInsightsFromRecords(records: ToolExecutionRecord[]): string | null {
  const scopedRecords = selectPreferredAttendanceRecords(
    records,
    ['hr_meeting_attendance_records'],
    ['meeting_attendance_records']
  );
  const attendanceTables = new Set(['hr_meeting_attendance_records', 'meeting_attendance_records']);
  const rows: Array<{ sNumber: string; date: string; status: string }> = [];

  for (const record of scopedRecords) {
    if (!record.table || !attendanceTables.has(record.table)) continue;
    for (const row of record.rows) {
      const sNumberRaw = row.s_number ?? row.employee_s_number ?? row.student_number;
      const dateRaw = row.checkin_date ?? row.date ?? row.shift_date;
      const statusRaw = row.effective_status ?? row.status;
      const sNumber = typeof sNumberRaw === 'string' ? sNumberRaw.trim() : '';
      const date = typeof dateRaw === 'string' ? dateRaw.trim() : '';
      const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : '';
      if (!sNumber || !date) continue;
      if (!isDateOnOrBeforeToday(date)) continue;
      rows.push({ sNumber, date, status });
    }
  }

  if (!rows.length) return null;

  const deduped = new Map<string, { sNumber: string; date: string; status: string }>();
  for (const row of rows) {
    const key = `${row.sNumber}|${row.date}|${row.status}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }

  const byDate = new Map<string, { total: number; presentExcused: number; absent: number; excused: number }>();
  for (const row of deduped.values()) {
    const bucket = byDate.get(row.date) ?? { total: 0, presentExcused: 0, absent: 0, excused: 0 };
    bucket.total += 1;
    if (row.status === 'present' || row.status === 'excused') bucket.presentExcused += 1;
    if (row.status === 'absent') bucket.absent += 1;
    if (row.status === 'excused') bucket.excused += 1;
    byDate.set(row.date, bucket);
  }

  const ordered = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (!ordered.length) return null;
  const capped = ordered.slice(-24);
  const average =
    capped.reduce((acc, [, stats]) => acc + (stats.total ? (stats.presentExcused / stats.total) * 100 : 0), 0) /
    capped.length;

  const lines = capped.map(([date, stats]) => {
    const rate = stats.total ? Math.round((stats.presentExcused / stats.total) * 100) : 0;
    return `${date}: ${stats.presentExcused}/${stats.total} present/excused (${rate}%), absent ${stats.absent}, excused ${stats.excused}`;
  });

  return [
    `Meeting-by-meeting attendance (${capped[0]?.[0]} to ${capped[capped.length - 1]?.[0]}): ${capped.length} meeting(s), average ${Math.round(average)}%.`,
    ...lines
  ].join('\n');
}

function buildMorningShiftOverviewFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildShiftOverviewFromRecords(records, {
    label: 'Morning shift',
    preferredTables: ['hr_morning_shift_attendance'],
    fallbackTables: ['morning_shift_attendance']
  });
}

function buildOffPeriodShiftOverviewFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildShiftOverviewFromRecords(records, {
    label: 'Off-period shift',
    preferredTables: ['hr_off_period_shift_attendance'],
    fallbackTables: ['off_period_shift_attendance']
  });
}

function buildGeneralShiftOverviewFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildShiftOverviewFromRecords(records, {
    label: 'Shift attendance',
    preferredTables: ['hr_shift_attendance'],
    fallbackTables: ['shift_attendance']
  });
}

function buildShiftOverviewFromRecords(
  records: ToolExecutionRecord[],
  params: { label: string; preferredTables: string[]; fallbackTables: string[] }
): string | null {
  const scopedRecords = selectPreferredAttendanceRecords(records, params.preferredTables, params.fallbackTables);
  const shiftTables = new Set([...params.preferredTables, ...params.fallbackTables]);
  const shiftRows: Array<{ sNumber: string; date: string; status: string }> = [];
  const studentBySNumber = buildStudentDirectory(records);

  for (const record of scopedRecords) {
    if (!record.table) continue;
    if (shiftTables.has(record.table)) {
      for (const row of record.rows) {
        const sNumberRaw = row.employee_s_number ?? row.s_number ?? row.student_number;
        const dateRaw = row.shift_date ?? row.date;
        const statusRaw = row.status;
        const sNumber = typeof sNumberRaw === 'string' ? sNumberRaw.trim() : '';
        const date = typeof dateRaw === 'string' ? dateRaw.trim() : '';
        const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : '';
        if (!sNumber || !date) continue;
        if (!isDateOnOrBeforeToday(date)) continue;
        shiftRows.push({ sNumber, date, status });
      }
    }
  }

  if (!shiftRows.length) return null;

  const deduped = new Map<string, { sNumber: string; date: string; status: string }>();
  for (const row of shiftRows) {
    const key = `${row.sNumber}|${row.date}|${row.status}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const rows = Array.from(deduped.values());
  const orderedDates = rows.map((row) => row.date).sort();
  const latestDate = orderedDates.at(-1) ?? '';
  const firstDate = orderedDates.at(0) ?? '';
  const latestRows = latestDate ? rows.filter((row) => row.date === latestDate) : [];
  const latestPresentExcused = latestRows.filter((row) => row.status === 'present' || row.status === 'excused').length;

  const absentNames = latestRows
    .filter((row) => row.status === 'absent')
    .map((row) => resolveDisplayName(studentBySNumber, row.sNumber));
  const presentNames = latestRows
    .filter((row) => row.status === 'present' || row.status === 'excused')
    .map((row) => resolveDisplayName(studentBySNumber, row.sNumber));

  const aggregate = new Map<string, { total: number; presentExcused: number }>();
  for (const row of rows) {
    const current = aggregate.get(row.sNumber) ?? { total: 0, presentExcused: 0 };
    current.total += 1;
    if (row.status === 'present' || row.status === 'excused') current.presentExcused += 1;
    aggregate.set(row.sNumber, current);
  }
  const minShiftsForFlag = 3;
  const rollup = Array.from(aggregate.entries())
    .map(([sNumber, stat]) => {
      const rate = stat.total > 0 ? (stat.presentExcused / stat.total) * 100 : 0;
      return {
        sNumber,
        name: resolveDisplayName(studentBySNumber, sNumber),
        total: stat.total,
        presentExcused: stat.presentExcused,
        rate
      };
    })
    .filter((row) => row.total >= minShiftsForFlag);

  const below50 = rollup
    .filter((row) => row.rate < 50)
    .sort((a, b) => a.rate - b.rate || b.total - a.total || a.name.localeCompare(b.name));
  const below70 = rollup
    .filter((row) => row.rate < 70)
    .sort((a, b) => a.rate - b.rate || b.total - a.total || a.name.localeCompare(b.name));
  const fmt = (rowsToFormat: typeof below70) =>
    rowsToFormat.slice(0, 60).map((row) => `${row.name} (${Math.round(row.rate)}%, ${row.presentExcused}/${row.total})`).join('; ');

  return [
    `${params.label} overview (${latestDate || 'latest date unavailable'}): ${latestPresentExcused}/${latestRows.length} present/excused.`,
    `Window analyzed: ${firstDate || 'unknown'} to ${latestDate || 'unknown'}.`,
    `Present/excused: ${presentNames.length ? presentNames.join(', ') : 'none'}.`,
    `Absent: ${absentNames.length ? absentNames.join(', ') : 'none'}.`,
    `Below 50% attendance (min ${minShiftsForFlag} shifts): ${below50.length ? fmt(below50) : 'none'}.`,
    `Below 70% attendance (min ${minShiftsForFlag} shifts): ${below70.length ? fmt(below70) : 'none'}.`
  ].join(' ');
}

function buildTopMorningShiftWorkersFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildTopShiftWorkersFromRecords(records, {
    label: 'morning shifts',
    preferredTables: ['hr_morning_shift_attendance'],
    fallbackTables: ['morning_shift_attendance']
  });
}

function buildTopOffPeriodShiftWorkersFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildTopShiftWorkersFromRecords(records, {
    label: 'off-period shifts',
    preferredTables: ['hr_off_period_shift_attendance'],
    fallbackTables: ['off_period_shift_attendance']
  });
}

function buildTopGeneralShiftWorkersFromRecords(records: ToolExecutionRecord[]): string | null {
  return buildTopShiftWorkersFromRecords(records, {
    label: 'shifts',
    preferredTables: ['hr_shift_attendance'],
    fallbackTables: ['shift_attendance']
  });
}

function buildTopShiftWorkersFromRecords(
  records: ToolExecutionRecord[],
  params: { label: string; preferredTables: string[]; fallbackTables: string[] }
): string | null {
  const scopedRecords = selectPreferredAttendanceRecords(records, params.preferredTables, params.fallbackTables);
  const shiftTables = new Set([...params.preferredTables, ...params.fallbackTables]);
  const studentBySNumber = buildStudentDirectory(records);
  const studentByAnyId = new Map<string, string>();
  const workerCounts = new Map<string, number>();

  for (const [sNumber, name] of studentBySNumber.entries()) {
    studentByAnyId.set(sNumber, name);
  }

  for (const record of scopedRecords) {
    if (!record.table) continue;
    if (record.table === 'students') {
      for (const row of record.rows) {
        const idCandidates = [row.s_number, row.student_number, row.id]
          .map((value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''))
          .filter(Boolean);
        const first = typeof row.first_name === 'string' ? row.first_name.trim() : '';
        const last = typeof row.last_name === 'string' ? row.last_name.trim() : '';
        const joined = `${first} ${last}`.trim();
        const nameCandidates = [row.name, row.full_name, row.student_name, joined]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean);
        const bestName = nameCandidates[0] ?? '';
        if (!bestName) continue;
        for (const candidate of idCandidates) {
          studentByAnyId.set(candidate, bestName);
        }
      }
      continue;
    }

    if (shiftTables.has(record.table)) {
      for (const row of record.rows) {
        const workerIdRaw = row.employee_s_number ?? row.s_number ?? row.student_number ?? row.employee_id;
        const dateRaw = row.shift_date ?? row.date;
        const workerId =
          typeof workerIdRaw === 'string' || typeof workerIdRaw === 'number' ? String(workerIdRaw).trim() : '';
        const date = typeof dateRaw === 'string' ? dateRaw.trim() : '';
        if (!workerId || !date) continue;
        if (!isDateOnOrBeforeToday(date)) continue;
        const statusRaw = row.status;
        const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : '';
        if (status !== 'present' && status !== 'excused') continue;
        workerCounts.set(workerId, (workerCounts.get(workerId) ?? 0) + 1);
      }
    }
  }

  if (!workerCounts.size) return null;

  const ranked = Array.from(workerCounts.entries())
    .map(([workerId, count]) => ({
      workerId,
      name: studentByAnyId.get(workerId) ?? 'Unknown employee',
      count
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const topCount = ranked[0]?.count ?? 0;
  const leaders = ranked.filter((row) => row.count === topCount).slice(0, 20);
  const nextTier = ranked.filter((row) => row.count < topCount).slice(0, 20);

  return [
    `Most ${params.label} worked: ${topCount} shift(s).`,
    `Top worker(s): ${leaders.map((row) => `${row.name} (${row.count})`).join('; ') || 'none'}.`,
    nextTier.length ? `Next highest: ${nextTier.map((row) => `${row.name} (${row.count})`).join('; ')}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function buildOperationalFallbackReply(params: {
  message: string;
  overview: ExecutiveOverviewData | null;
  toolContext: string;
  executionRecords: ToolExecutionRecord[];
  wantsAttendancePrecision: boolean;
  wantsOperationalData: boolean;
}): string {
  if (params.wantsAttendancePrecision) {
    const wantsMeeting = isMorningMeetingPrompt(params.message);
    const wantsShift = isShiftAttendancePrompt(params.message);
    const shiftScope = resolveRequestedShiftScope(params.message);
    if (wantsMeeting && !wantsShift) {
      const meeting = buildMorningMeetingOverviewFromRecords(params.executionRecords);
      if (meeting) return meeting;
    }
    if (wantsShift && !wantsMeeting) {
      const shift =
        shiftScope === 'off_period'
          ? buildOffPeriodShiftOverviewFromRecords(params.executionRecords)
          : shiftScope === 'morning'
            ? buildMorningShiftOverviewFromRecords(params.executionRecords)
            : buildGeneralShiftOverviewFromRecords(params.executionRecords);
      if (shift) return shift;
    }
    const meeting = buildMorningMeetingOverviewFromRecords(params.executionRecords);
    const shift =
      shiftScope === 'off_period'
        ? buildOffPeriodShiftOverviewFromRecords(params.executionRecords)
        : shiftScope === 'morning'
          ? buildMorningShiftOverviewFromRecords(params.executionRecords)
          : buildGeneralShiftOverviewFromRecords(params.executionRecords);
    const combined = [meeting, shift].filter(Boolean).join('\n\n');
    if (combined) return combined;
  }

  if (params.wantsOperationalData && params.overview) {
    return `I could not get a model-written reply for this turn, so here is the validated tool summary: ${params.overview.executiveBrief}`;
  }

  if (params.wantsOperationalData && params.toolContext.trim()) {
    const toolLines = params.toolContext
      .split('\n')
      .filter((line) => line.startsWith('Result: '))
      .map((line) => line.replace(/^Result:\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (toolLines.length) {
      return `I could not get a model-written reply, so here are tool results: ${toolLines.join(' ')}`;
    }
  }

  return 'I could not generate a model reply for this turn. Please retry your request.';
}

function buildDeterministicInsightContext(params: {
  message: string;
  executionRecords: ToolExecutionRecord[];
  wantsAttendancePrecision: boolean;
  wantsOperationalData: boolean;
  overview: ExecutiveOverviewData | null;
}): string | null {
  const lines: string[] = [];

  if (params.wantsAttendancePrecision && params.executionRecords.length > 0) {
    const wantsMeeting = isMorningMeetingPrompt(params.message);
    const wantsShift = isShiftAttendancePrompt(params.message);
    const shiftScope = resolveRequestedShiftScope(params.message);

    if (wantsMeeting && !wantsShift) {
      const meeting = buildMorningMeetingOverviewFromRecords(params.executionRecords);
      if (meeting) lines.push(meeting);
      if (wantsMeetingByMeetingBreakdown(params.message)) {
        const perMeeting = buildMeetingByMeetingInsightsFromRecords(params.executionRecords);
        if (perMeeting) lines.push(perMeeting);
      }
    } else if (wantsShift && !wantsMeeting) {
      const shift =
        shiftScope === 'off_period'
          ? buildOffPeriodShiftOverviewFromRecords(params.executionRecords)
          : shiftScope === 'morning'
            ? buildMorningShiftOverviewFromRecords(params.executionRecords)
            : buildGeneralShiftOverviewFromRecords(params.executionRecords);
      if (shift) lines.push(shift);
    } else {
      const meeting = buildMorningMeetingOverviewFromRecords(params.executionRecords);
      const shift =
        shiftScope === 'off_period'
          ? buildOffPeriodShiftOverviewFromRecords(params.executionRecords)
          : shiftScope === 'morning'
            ? buildMorningShiftOverviewFromRecords(params.executionRecords)
            : buildGeneralShiftOverviewFromRecords(params.executionRecords);
      if (meeting) lines.push(meeting);
      if (meeting && wantsMeetingByMeetingBreakdown(params.message)) {
        const perMeeting = buildMeetingByMeetingInsightsFromRecords(params.executionRecords);
        if (perMeeting) lines.push(perMeeting);
      }
      if (shift) lines.push(shift);
    }

    if (isTopMorningShiftPrompt(params.message)) {
      const shiftScope = resolveRequestedShiftScope(params.message);
      const topWorkers =
        shiftScope === 'off_period'
          ? buildTopOffPeriodShiftWorkersFromRecords(params.executionRecords)
          : shiftScope === 'morning'
            ? buildTopMorningShiftWorkersFromRecords(params.executionRecords)
            : buildTopGeneralShiftWorkersFromRecords(params.executionRecords);
      if (topWorkers) lines.push(topWorkers);
    }
  }

  if (params.wantsOperationalData && params.overview && isScheduleRosterPrompt(params.message)) {
    lines.push(buildScheduleAssistantReply(params.message, params.overview));
  }

  return lines.length ? lines.join('\n\n') : null;
}

function stripLegacyProvenanceBlock(text: string): string {
  return text.replace(/\n*\[provenance\][\s\S]*$/i, '').trim();
}

function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function streamOllamaMessage(
  response: Response,
  onDelta: (text: string) => void
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { message?: { content?: unknown }; response?: unknown; done?: unknown };
        const delta =
          typeof parsed.message?.content === 'string'
            ? parsed.message.content
            : typeof parsed.response === 'string'
              ? parsed.response
              : '';
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      } catch {
        // Ignore non-JSON lines from upstream stream.
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim()) as { message?: { content?: unknown }; response?: unknown };
      const delta =
        typeof parsed.message?.content === 'string'
          ? parsed.message.content
          : typeof parsed.response === 'string'
            ? parsed.response
            : '';
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    } catch {
      // Ignore trailing parse errors.
    }
  }

  return content;
}

function parseAssistantMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { message?: { content?: unknown }; response?: unknown };
  if (typeof candidate.message?.content === 'string') return candidate.message.content;
  if (typeof candidate.response === 'string') return candidate.response;
  return null;
}

function maybeToolingCache(payload: unknown): ToolingCachePayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as {
    generatedAt?: unknown;
    toolContext?: unknown;
    overview?: unknown;
    toolTrace?: unknown;
  };
  if (typeof candidate.generatedAt !== 'string') return null;
  if (typeof candidate.toolContext !== 'string') return null;
  if (!candidate.overview || typeof candidate.overview !== 'object') return null;
  if (!Array.isArray(candidate.toolTrace)) return null;
  return candidate as ToolingCachePayload;
}

function isRecentCache(createdAt: string, maxAgeMs = 2 * 60 * 1000): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= maxAgeMs;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { error?: unknown; message?: unknown };
      const maybeError =
        (typeof payload.error === 'string' && payload.error) ||
        (typeof payload.message === 'string' && payload.message) ||
        '';
      if (maybeError) return maybeError;
      return JSON.stringify(payload);
    }
    const text = (await response.text()).trim();
    if (/<!doctype html/i.test(text) || /<html/i.test(text)) {
      if (/vercel/i.test(text) || /authentication required/i.test(text)) {
        return 'Received Vercel authentication HTML page from upstream instead of Ollama API JSON.';
      }
      return 'Received HTML response from upstream instead of Ollama API JSON.';
    }
    if (text) return text.slice(0, 500);
    return '';
  } catch {
    return '';
  }
}

function parseJsonObjectString(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Continue with fallback extraction.
  }

  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // Continue with fallback extraction.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeFactCandidates(payload: unknown): MemoryFactCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const facts = (payload as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];

  return facts
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as {
        factText?: unknown;
        category?: unknown;
        importance?: unknown;
      };
      const factText = typeof row.factText === 'string' ? row.factText.trim() : '';
      const category = typeof row.category === 'string' ? row.category.trim().toLowerCase() : 'context';
      const importance =
        typeof row.importance === 'number'
          ? row.importance
          : typeof row.importance === 'string'
            ? Number(row.importance)
            : 3;
      if (!factText) return null;
      return {
        factText: factText.slice(0, 600),
        category: category || 'context',
        importance: Math.min(Math.max(Math.round(Number.isFinite(importance) ? importance : 3), 1), 5)
      };
    })
    .filter((row): row is MemoryFactCandidate => Boolean(row));
}

function formatToolManifest(catalog: ToolCatalogEntry[]): string {
  const departmentPacks = catalog.filter((tool) => tool.kind === 'department_pack');
  const discoveryTools = catalog.filter((tool) => tool.kind === 'discovery_tool');
  const tableToolsByDepartment = new Map<string, ToolCatalogEntry[]>();

  for (const tableTool of catalog.filter((tool) => tool.kind === 'table_tool')) {
    const bucket = tableToolsByDepartment.get(tableTool.department) ?? [];
    bucket.push(tableTool);
    tableToolsByDepartment.set(tableTool.department, bucket);
  }

  const lines: string[] = [];
  lines.push('Department packs:');
  lines.push(...departmentPacks.map((tool) => `- ${tool.id} (${tool.label})`));
  lines.push('Discovery tools:');
  lines.push(...discoveryTools.map((tool) => `- ${tool.id}`));
  lines.push('Table tools by department:');
  for (const [department, tools] of Array.from(tableToolsByDepartment.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    lines.push(`- ${department}: ${tools.length} tools`);
    lines.push(`  ${tools.map((tool) => tool.id).join(', ')}`);
  }
  return lines.join('\n');
}

function extractKnownNamesFromRecords(records: ToolExecutionRecord[]): Set<string> {
  const names = new Set<string>();
  for (const record of records) {
    if (!record.table) continue;
    for (const row of record.rows) {
      const candidates = [
        row.name,
        row.full_name,
        row.student_name,
        row.first_name && row.last_name ? `${String(row.first_name)} ${String(row.last_name)}` : null
      ];
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) {
          names.add(value.trim().toLowerCase());
        }
      }
    }
  }
  return names;
}

function extractResponseCandidateNames(message: string): string[] {
  const names = new Set<string>();
  const lineMatches = message.match(/(?:^|\n)[-•]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(/gm) ?? [];
  for (const match of lineMatches) {
    const cleaned = match
      .replace(/^[-•\s]+/, '')
      .replace(/\(.*/, '')
      .trim();
    if (cleaned) names.add(cleaned);
  }

  const inlineMatches = message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g) ?? [];
  for (const token of inlineMatches) {
    if (token.toLowerCase().includes('source') || token.toLowerCase().includes('provenance')) continue;
    if (token.split(' ').length >= 2) names.add(token.trim());
  }
  return Array.from(names);
}

function validateAssistantAgainstRecords(params: {
  assistantMessage: string;
  records: ToolExecutionRecord[];
  enabled: boolean;
}): ValidationResult {
  if (!params.enabled) return { passed: true, mismatches: [] };
  const knownNames = extractKnownNamesFromRecords(params.records);
  const mentioned = extractResponseCandidateNames(params.assistantMessage);
  const mismatches = mentioned.filter((name) => !knownNames.has(name.toLowerCase()));
  return {
    passed: mismatches.length === 0,
    mismatches,
    retryReason: mismatches.length
      ? `Response referenced names not present in current tool rows: ${mismatches.join(', ')}`
      : undefined
  };
}

function buildProvenance(params: {
  records: ToolExecutionRecord[];
  toolTrace: ExecutiveToolTraceItem[];
  validationStatus: AnswerProvenance['validationStatus'];
}): AnswerProvenance {
  const sourceTables = Array.from(new Set(params.records.map((record) => record.table).filter(Boolean))) as string[];
  const rowCounts: Record<string, number> = {};
  const window: Array<{ table: string; column?: string; from?: string; to?: string }> = [];
  const filters: Array<{ table: string; filters: ToolQueryFilter[] }> = [];
  for (const record of params.records) {
    if (!record.table) continue;
    rowCounts[record.table] = record.rowCount;
    if (record.effectiveWindow) {
      window.push({
        table: record.table,
        column: record.effectiveWindow.column,
        from: record.effectiveWindow.from,
        to: record.effectiveWindow.to
      });
    }
    filters.push({
      table: record.table,
      filters: record.args.filters ?? []
    });
  }
  return {
    sourceTables,
    window,
    filters,
    rowCounts,
    toolIds: params.toolTrace.map((tool) => tool.id),
    validationStatus: params.validationStatus
  };
}

function toToolTraceItem(params: {
  id: string;
  status: 'complete' | 'failed';
  detail: string;
  startedAt: string;
  finishedAt: string;
}): ExecutiveToolTraceItem {
  return {
    id: params.id,
    label: getToolSpecById(params.id)?.label ?? params.id,
    status: params.status,
    detail: params.detail,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}

function memoryFactsToPromptContext(
  facts: Array<{ factText: string; category: string; importance: number }>
): string {
  if (!facts.length) return 'No saved user preferences yet.';
  return facts.map((fact) => `[${fact.category} | ${fact.importance}/5] ${fact.factText}`).join('\n');
}

async function extractMemoryFactsWithSmallModel(params: {
  userMessage: string;
  assistantMessage: string;
  existingFactsPrompt: string;
}): Promise<MemoryFactCandidate[]> {
  const memoryModel = process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b';

  const extractionPrompt = [
    'You are a compact memory extraction model.',
    'Extract durable user preferences and critical facts from the latest exchange.',
    'Do not include transient details or one-off operational events.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    '{"facts":[{"factText":"string","category":"preference|constraint|goal|profile|context","importance":1-5}]}',
    '',
    'Existing known facts:',
    params.existingFactsPrompt,
    '',
    'Latest user message:',
    params.userMessage,
    '',
    'Latest assistant response:',
    params.assistantMessage
  ].join('\n');

  const upstream = await proxyOllamaChatRequest({
    body: {
      model: memoryModel,
      stream: false,
      messages: [{ role: 'user', content: extractionPrompt }],
      options: { temperature: 0.0 }
    }
  });

  if (!upstream.ok) return [];
  const upstreamPayload = (await upstream.json()) as unknown;
  const content = parseAssistantMessage(upstreamPayload);
  if (!content) return [];

  const parsed = parseJsonObjectString(content);
  return normalizeFactCandidates(parsed);
}

export async function POST(request: NextRequest) {
  try {
    const allowed = await ensureServerPermission('executive.ai_agent.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      message?: unknown;
      sessionId?: unknown;
      userKey?: unknown;
      conversation?: unknown;
      stream?: unknown;
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const streamRequested = body.stream === true;
    if (!message) {
      return NextResponse.json({ ok: false, error: 'Message is required.' }, { status: 400 });
    }

    const userKey = resolveUserKey(typeof body.userKey === 'string' ? body.userKey : null);
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim().slice(0, 120)
        : `session-${crypto.randomUUID()}`;

    const toolTrace: ExecutiveToolTraceItem[] = [];

    const preferencesToolStart = new Date().toISOString();
    let memoryFacts: Awaited<ReturnType<typeof getUserMemoryFacts>> = [];
    try {
      memoryFacts = await getUserMemoryFacts(userKey, 12);
      const preferencesToolEnd = new Date().toISOString();
      const sampleFacts = memoryFacts.slice(0, 3).map((fact) => fact.factText).join(' | ');
      toolTrace.push(
        toToolTraceItem({
          id: 'get_user_preferences',
          status: 'complete',
          detail: memoryFacts.length
            ? `Load durable preferences from Supabase memory. Result: Loaded ${memoryFacts.length} memory fact(s).${sampleFacts ? ` Sample: ${sampleFacts}` : ''}`
            : 'Load durable preferences from Supabase memory. Result: No saved preferences yet; memory table is empty for this user.',
          startedAt: preferencesToolStart,
          finishedAt: preferencesToolEnd
        })
      );
    } catch (error) {
      const preferencesToolEnd = new Date().toISOString();
      toolTrace.push(
        toToolTraceItem({
          id: 'get_user_preferences',
          status: 'failed',
          detail: `Load durable preferences from Supabase memory. Result: ${
            error instanceof Error ? error.message : 'Failed to fetch memory from Supabase.'
          }`,
          startedAt: preferencesToolStart,
          finishedAt: preferencesToolEnd
        })
      );
      memoryFacts = [];
    }

    await insertConversationMessage({
      userKey,
      sessionId,
      role: 'user',
      content: message,
      metadata: { source: 'executive_chat_api' }
    });

    const memoryContext = memoryFactsToPromptContext(memoryFacts);
    const wantsOperationalData = isOperationalDataPrompt(message) || isToolListingPrompt(message);
    const wantsToolList = isToolListingPrompt(message);
    const wantsAttendancePrecision = isAttendancePrecisionPrompt(message);
    const streamEnabled = streamRequested && !wantsAttendancePrecision;
    const isGreeting = isGreetingPrompt(message);

    let overview: ExecutiveOverviewData | null = null;
    let toolContext = '';
    let overviewToolTrace: ExecutiveToolTraceItem[] = [];
    let toolCatalog: ToolCatalogEntry[] = [];
    let queryPlan: QueryPlan | null = null;
    let executionRecords: ToolExecutionRecord[] = [];
    let toolingMode: 'fresh' | 'reused' | 'skipped' = 'skipped';

    if (wantsOperationalData) {
      const latestAssistantState = await getLatestAssistantMessageState({ userKey, sessionId });
      const cachedTooling = maybeToolingCache(
        latestAssistantState?.metadata?.tooling_cache ?? null
      );
      const cacheReusable =
        Boolean(latestAssistantState && cachedTooling) &&
        !requiresFreshDataPrompt(message) &&
        isRecentCache(latestAssistantState?.createdAt ?? '');

      if (cacheReusable && cachedTooling && latestAssistantState) {
        toolingMode = 'reused';
        overview = cachedTooling.overview;
        toolContext = cachedTooling.toolContext;
        toolCatalog = cachedTooling.toolCatalog ?? [];
        queryPlan = cachedTooling.queryPlan ?? null;
        executionRecords = cachedTooling.executionRecords ?? [];
        const startedAt = new Date().toISOString();
        const finishedAt = new Date().toISOString();
        overviewToolTrace = [
          toToolTraceItem({
            id: 'use_recent_context',
            status: 'complete',
            detail: `Reused recent executive context from ${latestAssistantState.createdAt}.`,
            startedAt,
            finishedAt
          }),
          ...cachedTooling.toolTrace
        ];
      } else {
        toolingMode = 'fresh';
        const toolingResult = await runExecutiveTooling(message);
        overview = toolingResult.overview;
        toolContext = toolingResult.toolContext;
        overviewToolTrace = toolingResult.toolTrace;
        toolCatalog = toolingResult.toolCatalog;
        queryPlan = toolingResult.queryPlan;
        executionRecords = toolingResult.executionRecords;
      }
    }

    if (wantsToolList && toolCatalog.length) {
      const manifestMessage = formatToolManifest(toolCatalog);
      await insertConversationMessage({
        userKey,
        sessionId,
        role: 'assistant',
        content: manifestMessage,
        model: process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud',
        metadata: {
          source: 'tooling',
          tooling_mode: toolingMode,
          tool_manifest_only: true
        }
      });
      return NextResponse.json({
        ok: true,
        source: 'tooling',
        model: process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud',
        userKey,
        sessionId,
        assistantMessage: manifestMessage,
        toolTrace: [...toolTrace, ...overviewToolTrace],
        memoryFactsWritten: 0
      });
    }

    const deterministicInsightContext = buildDeterministicInsightContext({
      message,
      executionRecords,
      wantsAttendancePrecision,
      wantsOperationalData,
      overview
    });

    const systemPrompt = [
      'You are the executive AI agent for the CO-OP Operations dashboard.',
      'Conversation style requirements:',
      '- Be natural and concise.',
      '- If the user says hi/hello/small-talk, respond casually in 1-2 sentences and ask what they want.',
      '- Do not dump metrics unless the user explicitly asks for status, overview, trends, or analysis.',
      '- When discussing shift attendance, prioritize morning and off-period attendance and their average; do not prioritize general shift attendance.',
      '- Ground every factual claim in the provided tool outputs or conversation history. Never invent fields, departments, or placeholders.',
      '- Always prefer person names over IDs in responses. If a name is unavailable, use "Unknown (ID)" once and avoid ID-only lists.',
      '- Assume you have access to the executive tool outputs across HR, Product, Finance, Marketing, Inventory, CFA, and shared calendar when they are provided below.',
      '- Do not claim lack of access unless tool outputs for that domain are truly absent in this turn; if absent, state exactly which dataset is missing.',
      '- Do not produce generic numbered templates (for example 1..10 categories) unless the user explicitly asks for that format.',
      '- For direct questions like "who came?" or "how many came?", answer in the first sentence with exact date + names/counts from tool output.',
      '- For "consistently skipped" / "<50% attendance" questions, use morning meeting trend results from tool output and return names with percentages.',
      '- Never return raw employee IDs in user-facing answers. Use names; if unknown, write "Unknown employee".',
      '- Do not dump unformatted blobs. Provide a short interpreted summary with key concerns first, then concise supporting details.',
      '- Avoid repetitive wording and avoid unnecessary warnings.',
      '- If a specific detail is unavailable, state exactly what is missing and continue with the available data.',
      '',
      'Saved user preferences and critical facts:',
      memoryContext,
      '',
      wantsOperationalData && overview
        ? `Executive overview snapshot:\n${overview.executiveBrief}`
        : 'No operational tool snapshot was requested for this turn.',
      '',
      wantsOperationalData && toolContext
        ? `Tool outputs:\n${toolContext}`
        : 'No operational tool output was requested for this turn.',
      '',
      wantsOperationalData && queryPlan
        ? `Structured query plan:\n${JSON.stringify(queryPlan)}`
        : 'No query plan was generated for this turn.',
      '',
      wantsOperationalData && executionRecords.length
        ? `Structured execution records:\n${JSON.stringify(
            executionRecords.map((record) => ({
              toolId: record.toolId,
              table: record.table,
              rowCount: record.rowCount,
              rowHash: record.rowHash,
              effectiveWindow: record.effectiveWindow,
              rows: record.rows
            }))
          )}`
        : 'No execution records were generated for this turn.',
      '',
      deterministicInsightContext
        ? `Deterministic insight pre-analysis (derived from tool rows, use this first):\n${deterministicInsightContext}`
        : 'No deterministic pre-analysis was generated for this turn.',
      '',
      isGreeting
        ? 'The latest user message is a greeting or casual opener. Keep your response short and friendly.'
        : 'Answer directly based on the user request.'
    ].join('\n');

    const model = process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud';
    const dbConversation = await listRecentConversationContext({ userKey, sessionId, limit: 20 });

    const fallbackConversation = Array.isArray(body.conversation)
      ? body.conversation.filter(
          (entry): entry is ChatMessage =>
            typeof entry === 'object' &&
            entry !== null &&
            'role' in entry &&
            'content' in entry &&
            (entry as ChatMessage).role !== 'system' &&
            typeof (entry as ChatMessage).content === 'string'
        )
      : [];

    const contextConversation = dbConversation.length
      ? dbConversation
      : fallbackConversation.map((entry) => ({ role: entry.role, content: entry.content }));
    const recentConversation = contextConversation.slice(isGreeting ? -2 : -12);
    const lastContextMessage = recentConversation[recentConversation.length - 1];
    const hasCurrentUserPromptAlready =
      lastContextMessage?.role === 'user' &&
      lastContextMessage.content.trim().toLowerCase() === message.trim().toLowerCase();

    let assistantMessage = '';
    let source: 'ollama' | 'fallback' | 'tooling' = 'ollama';
    let upstream: Response | null = null;

    upstream = await proxyOllamaChatRequest({
      body: {
        model,
        stream: streamEnabled,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentConversation.map((entry) => ({
            role: entry.role,
            content: entry.content
          })),
          ...(hasCurrentUserPromptAlready ? [] : [{ role: 'user', content: message }])
        ],
        options: {
          temperature: 0.1
        }
      }
    });

    if (!upstream.ok) {
      source = 'fallback';
      const upstreamDetail = await readResponseError(upstream);
      const debugId = upstream.headers.get('x-coop-ollama-debug-id') ?? '';
      const isAuthError = upstream.status === 401 || upstream.status === 403;
      assistantMessage = [
        isAuthError
          ? 'Ollama authentication failed through the internal proxy.'
          : 'Unable to reach Ollama through the internal proxy right now.',
        `Upstream status: ${upstream.status}.`,
        upstreamDetail ? `Upstream detail: ${upstreamDetail}` : '',
        debugId ? `Debug ID: ${debugId}.` : '',
        isAuthError
          ? 'Check OLLAMA_API_KEY and OLLAMA_BASE_URL in Vercel environment settings.'
          : '',
        overview ? `Executive snapshot: ${overview.executiveBrief}` : '',
        overview
          ? 'Check the Overview tab for current metrics and the Alerts tab for follow-up actions.'
          : 'Try again in a moment.'
      ]
        .filter(Boolean)
        .join(' ');
    } else if (!streamEnabled) {
      const upstreamJson = (await upstream.json()) as unknown;
      assistantMessage =
        parseAssistantMessage(upstreamJson) ??
        buildOperationalFallbackReply({
          message,
          overview,
          toolContext,
          executionRecords,
          wantsAttendancePrecision,
          wantsOperationalData
        });
      if (!assistantMessage?.trim()) {
        assistantMessage = buildOperationalFallbackReply({
          message,
          overview,
          toolContext,
          executionRecords,
          wantsAttendancePrecision,
          wantsOperationalData
        });
      }
    }

    let validationResult: ValidationResult = { passed: true, mismatches: [] };
    if (wantsAttendancePrecision && source === 'ollama' && assistantMessage) {
      validationResult = validateAssistantAgainstRecords({
        assistantMessage,
        records: executionRecords,
        enabled: true
      });
      if (!validationResult.passed) {
        const retryResponse = await proxyOllamaChatRequest({
          body: {
            model,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  message,
                  '',
                  'Correction requirement:',
                  validationResult.retryReason ?? 'Use only names that exist in tool rows for this turn.',
                  'Regenerate the answer with names/counts strictly from tool rows only.'
                ].join('\n')
              }
            ],
            options: { temperature: 0.0 }
          }
        });
        if (retryResponse.ok) {
          const retryPayload = (await retryResponse.json()) as unknown;
          const retryMessage = parseAssistantMessage(retryPayload) ?? assistantMessage;
          const retryValidation = validateAssistantAgainstRecords({
            assistantMessage: retryMessage,
            records: executionRecords,
            enabled: true
          });
          validationResult = retryValidation;
          if (retryValidation.passed) {
            assistantMessage = retryMessage;
          } else {
            assistantMessage =
              'I could not produce a fully validated attendance name list from the current tool rows. Please narrow the date range or ask for raw table output.';
            source = 'tooling';
          }
        }
      }
    }

    const provenance = buildProvenance({
      records: executionRecords,
      toolTrace: [...toolTrace, ...overviewToolTrace],
      validationStatus: wantsAttendancePrecision
        ? validationResult.passed
          ? 'passed'
          : 'failed'
        : wantsOperationalData
          ? 'not_applicable'
          : 'not_applicable'
    });

    assistantMessage = stripLegacyProvenanceBlock(assistantMessage);

    const assistantMetadata: Record<string, unknown> = {
      source,
      tooling_mode: toolingMode,
      query_plan: queryPlan,
      validation: validationResult,
      provenance
    };
    if (wantsOperationalData && overview) {
      assistantMetadata.tooling_cache = {
        generatedAt: new Date().toISOString(),
        toolContext,
        overview,
        toolTrace: overviewToolTrace,
        toolCatalog,
        queryPlan: queryPlan ?? undefined,
        executionRecords
      } satisfies ToolingCachePayload;
    }

    if (streamEnabled) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, payload: unknown) => {
            controller.enqueue(encoder.encode(sseEvent(event, payload)));
          };

          try {
            send('start', { sessionId, model });
            if (source === 'ollama' && upstream?.ok) {
              assistantMessage = await streamOllamaMessage(upstream, (delta) => {
                send('delta', { text: delta });
              });
              if (!assistantMessage.trim()) {
                source = 'tooling';
                assistantMessage = buildOperationalFallbackReply({
                  message,
                  overview,
                  toolContext,
                  executionRecords,
                  wantsAttendancePrecision,
                  wantsOperationalData
                });
                send('delta', { text: assistantMessage });
              }
            } else if (assistantMessage) {
              send('delta', { text: assistantMessage });
            }

            await insertConversationMessage({
              userKey,
              sessionId,
              role: 'assistant',
              content: assistantMessage,
              model: model,
              metadata: assistantMetadata
            });

            const memoryWriteStart = new Date().toISOString();
            let memoryWriteCount = 0;
            const shouldRunMemoryWriter = wantsOperationalData || message.trim().length >= 10;

            if (!shouldRunMemoryWriter) {
              const memoryWriteEnd = new Date().toISOString();
              toolTrace.push(
                toToolTraceItem({
                  id: 'sync_user_memory',
                  status: 'complete',
                  detail:
                    'Condense durable facts with qwen3:8b and sync memory. Result: skipped for short conversational turn.',
                  startedAt: memoryWriteStart,
                  finishedAt: memoryWriteEnd
                })
              );
            } else {
              try {
                const extractedFacts = await extractMemoryFactsWithSmallModel({
                  userMessage: message,
                  assistantMessage,
                  existingFactsPrompt: memoryContext
                });
                memoryWriteCount = await upsertUserMemoryFacts(
                  userKey,
                  sessionId,
                  extractedFacts.map((fact) => ({
                    factText: fact.factText,
                    category: fact.category,
                    importance: fact.importance
                  }))
                );
                const memoryWriteEnd = new Date().toISOString();
                toolTrace.push(
                  toToolTraceItem({
                    id: 'sync_user_memory',
                    status: 'complete',
                    detail:
                      memoryWriteCount > 0
                        ? `Condense durable facts with qwen3:8b and sync memory. Result: saved ${memoryWriteCount} condensed fact(s).`
                        : 'Condense durable facts with qwen3:8b and sync memory. Result: no new durable facts to store.',
                    startedAt: memoryWriteStart,
                    finishedAt: memoryWriteEnd
                  })
                );
              } catch (error) {
                const memoryWriteEnd = new Date().toISOString();
                toolTrace.push(
                  toToolTraceItem({
                    id: 'sync_user_memory',
                    status: 'failed',
                    detail: `Condense durable facts with qwen3:8b and sync memory. Result: ${
                      error instanceof Error ? error.message : 'Memory writer failed.'
                    }`,
                    startedAt: memoryWriteStart,
                    finishedAt: memoryWriteEnd
                  })
                );
              }
            }

            send('done', {
              ok: true,
              source,
              model,
              memoryModel: process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b',
              userKey,
              sessionId,
              assistantMessage,
              toolTrace: [...toolTrace, ...overviewToolTrace],
              queryPlan,
              validationResult,
              provenance,
              memoryFactsWritten: memoryWriteCount
            });
          } catch (error) {
            send('error', {
              ok: false,
              error: error instanceof Error ? error.message : 'Failed during executive chat streaming.'
            });
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        }
      });
    }

    await insertConversationMessage({
      userKey,
      sessionId,
      role: 'assistant',
      content: assistantMessage,
      model: model,
      metadata: assistantMetadata
    });

    const memoryWriteStart = new Date().toISOString();
    let memoryWriteCount = 0;
    const shouldRunMemoryWriter = wantsOperationalData || message.trim().length >= 10;

    if (!shouldRunMemoryWriter) {
      const memoryWriteEnd = new Date().toISOString();
        toolTrace.push(
          toToolTraceItem({
            id: 'sync_user_memory',
            status: 'complete',
            detail: 'Condense durable facts with qwen3:8b and sync memory. Result: skipped for short conversational turn.',
            startedAt: memoryWriteStart,
            finishedAt: memoryWriteEnd
          })
      );
    } else {
      try {
        const extractedFacts = await extractMemoryFactsWithSmallModel({
          userMessage: message,
          assistantMessage,
          existingFactsPrompt: memoryContext
        });
        memoryWriteCount = await upsertUserMemoryFacts(
          userKey,
          sessionId,
          extractedFacts.map((fact) => ({
            factText: fact.factText,
            category: fact.category,
            importance: fact.importance
          }))
        );
        const memoryWriteEnd = new Date().toISOString();
        toolTrace.push(
          toToolTraceItem({
            id: 'sync_user_memory',
            status: 'complete',
            detail:
              memoryWriteCount > 0
                ? `Condense durable facts with qwen3:8b and sync memory. Result: saved ${memoryWriteCount} condensed fact(s).`
                : 'Condense durable facts with qwen3:8b and sync memory. Result: no new durable facts to store.',
            startedAt: memoryWriteStart,
            finishedAt: memoryWriteEnd
          })
        );
      } catch (error) {
        const memoryWriteEnd = new Date().toISOString();
        toolTrace.push(
          toToolTraceItem({
            id: 'sync_user_memory',
            status: 'failed',
            detail: `Condense durable facts with qwen3:8b and sync memory. Result: ${
              error instanceof Error ? error.message : 'Memory writer failed.'
            }`,
            startedAt: memoryWriteStart,
            finishedAt: memoryWriteEnd
          })
        );
      }
    }

    return NextResponse.json({
      ok: true,
      source,
      model,
      memoryModel: process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b',
      userKey,
      sessionId,
      assistantMessage,
      toolTrace: [...toolTrace, ...overviewToolTrace],
      queryPlan,
      validationResult,
      provenance,
      memoryFactsWritten: memoryWriteCount
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to process executive chat.'
      },
      { status: 500 }
    );
  }
}
