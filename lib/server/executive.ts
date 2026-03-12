import { createServerClient } from '@/lib/supabase';
import { resolvePreferredTable } from '@/lib/server/common';
import { getToolSpecById, planExecutiveTools } from '@/lib/executive/tooling';

export interface ExecutiveSummaryCard {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'neutral' | 'positive' | 'warning';
}

export interface ExecutiveFeedItem {
  id: string;
  department: string;
  title: string;
  detail: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  href: string;
}

export interface ExecutiveAlert {
  id: string;
  title: string;
  department: string;
  severity: 'medium' | 'high';
  description: string;
  action: string;
}

export interface ExecutiveMetric {
  id: string;
  title: string;
  value: string;
  trend: string;
}

export interface ExecutiveReportItem {
  id: string;
  type: string;
  title: string;
  status: string;
  updatedAt: string;
  owner: string;
  href: string;
}

export interface DepartmentHealthItem {
  id: string;
  department: string;
  status: 'healthy' | 'watch' | 'risk';
  summary: string;
}

export interface ExecutiveOverviewData {
  generatedAt: string;
  executiveBrief: string;
  summaryCards: ExecutiveSummaryCard[];
  feed: ExecutiveFeedItem[];
  alerts: ExecutiveAlert[];
  metrics: ExecutiveMetric[];
  reports: ExecutiveReportItem[];
  departmentHealth: DepartmentHealthItem[];
  latestMorningMeeting?: {
    date: string | null;
    dateLabel: string;
    presentExcusedCount: number;
    totalCount: number;
    attendeeNames: string[];
    absentNames: string[];
  };
  morningMeetingTrend?: {
    windowStartDate: string;
    windowEndDate: string;
    totalMeetings: number;
    minMeetingsForFlag: number;
    underFiftyPercent: Array<{
      sNumber: string;
      name: string;
      attendanceRate: number;
      presentExcused: number;
      totalMeetings: number;
    }>;
  };
  shiftRequestInsights?: {
    pendingCount: number;
    pendingRequests: Array<{
      requesterSNumber: string;
      requesterName: string;
      replacementSNumber: string;
      replacementName: string;
      shiftDate: string;
      shiftPeriod: number;
      shiftSlotKey: string;
      requestedAt: string;
      reason: string;
    }>;
    frequentRequesters: Array<{
      requesterSNumber: string;
      requesterName: string;
      totalRequests: number;
      pendingRequests: number;
      approvedRequests: number;
      deniedRequests: number;
      lastRequestedAt: string;
    }>;
  };
}

export interface ExecutiveToolTraceItem {
  id: string;
  label: string;
  status: 'complete' | 'failed';
  startedAt: string;
  finishedAt: string;
  detail: string;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function orderSeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'partially_received' ? 'warning' : 'info';
}

function financeSeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'failed_validation' ? 'warning' : 'info';
}

function inventorySeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'active' ? 'warning' : 'info';
}

type Awaitable<T> = Promise<T> | PromiseLike<T>;

async function safeCount(
  queryFactory: () => Awaitable<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  try {
    const result = await queryFactory();
    if (result.error) return 0;
    return result.count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows<T>(
  queryFactory: () => Awaitable<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  try {
    const result = await queryFactory();
    if (result.error) return [];
    return result.data ?? [];
  } catch {
    return [];
  }
}

type ProductOrderRow = {
  id: string;
  order_number: string | null;
  status: string;
  created_at: string;
  requested_pickup_date: string | null;
};

type FinanceHeaderRow = {
  id: string;
  report_name: string;
  status: string;
  uploaded_by: string | null;
  uploaded_at: string;
  total_collected: number | null;
};

type MarketingEventRow = {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  updated_at: string;
};

type InventorySessionRow = {
  id: string;
  session_name: string;
  status: string;
  updated_at: string;
};

type ShiftAttendanceRow = {
  status: 'expected' | 'present' | 'absent' | 'excused';
  shift_date: string;
};

type SplitShiftAttendanceRow = {
  status: 'expected' | 'present' | 'absent' | 'excused';
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  employee_s_number: string;
};

type StudentNameRow = {
  [key: string]: unknown;
};

type MeetingAttendanceRow = {
  s_number: string;
  checkin_date: string;
  effective_status: 'present' | 'absent' | 'excused';
};

type CFAHistoryRow = {
  id: string;
  log_date: string;
  created_at: string;
};

type CalendarEventRow = {
  id: string;
  title: string;
  starts_at: string;
  source_department: string | null;
};

type ShiftRequestRow = {
  id: string;
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  from_employee_s_number: string;
  to_employee_s_number: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
};

interface AttendanceStats {
  expected: number;
  present: number;
  absent: number;
  excused: number;
  rate: number | null;
}

function buildAttendanceStats(rows: Array<{ status: SplitShiftAttendanceRow['status'] }>): AttendanceStats {
  const expected = rows.filter((row) => row.status === 'expected').length;
  const present = rows.filter((row) => row.status === 'present').length;
  const absent = rows.filter((row) => row.status === 'absent').length;
  const excused = rows.filter((row) => row.status === 'excused').length;
  const denominator = expected + present + absent + excused;
  const numerator = present + excused;
  const rate = denominator > 0 ? (numerator / denominator) * 100 : null;
  return { expected, present, absent, excused, rate };
}

function formatRatePercent(value: number | null): string {
  if (value === null) return 'No recent data';
  return `${Math.round(value)}%`;
}

function averageRates(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (!defined.length) return null;
  const sum = defined.reduce((total, value) => total + value, 0);
  return sum / defined.length;
}

function latestShiftDate(rows: SplitShiftAttendanceRow[]): string | null {
  const dates = rows.map((row) => row.shift_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function formatEmployeeName(
  sNumber: string,
  studentBySNumber: Map<string, string>
): string {
  return studentBySNumber.get(sNumber) ?? sNumber;
}

function readStringValue(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveStudentSNumber(row: StudentNameRow): string {
  return readStringValue(row, ['s_number', 'student_number']);
}

function resolveStudentName(row: StudentNameRow): string {
  const directName = readStringValue(row, ['name', 'full_name', 'student_name']);
  if (directName) return directName;
  const first = readStringValue(row, ['first_name', 'first']);
  const last = readStringValue(row, ['last_name', 'last']);
  return `${first} ${last}`.trim();
}

async function resolveTableOrNull(
  supabase: ReturnType<typeof createServerClient>,
  preferredTable: string,
  fallbackTable: string,
  probeColumn = 'id'
): Promise<string | null> {
  try {
    return await resolvePreferredTable(supabase, preferredTable, fallbackTable, probeColumn);
  } catch {
    return null;
  }
}

export async function fetchExecutiveOverview(): Promise<ExecutiveOverviewData> {
  const supabase = createServerClient();
  const nowIso = new Date().toISOString();
  const weekAgoIso = daysAgoIso(7);
  const twoWeeksAgoDate = daysAgoIso(14).slice(0, 10);
  const meetingTrendEndDate = nowIso.slice(0, 10);
  const minMeetingsForFlag = 3;

  const [shiftRequestsTable, morningAttendanceTable, offPeriodAttendanceTable, meetingAttendanceTable] = await Promise.all([
    resolveTableOrNull(supabase, 'hr_shift_change_requests', 'shift_change_requests'),
    resolveTableOrNull(supabase, 'hr_morning_shift_attendance', 'morning_shift_attendance', 'shift_date'),
    resolveTableOrNull(supabase, 'hr_off_period_shift_attendance', 'off_period_shift_attendance', 'shift_date'),
    resolveTableOrNull(supabase, 'hr_meeting_attendance_records', 'meeting_attendance_records', 'checkin_date')
  ]);

  const [
    newOrdersThisWeek,
    openShiftRequests,
    shiftRequestRows,
    recentProductOrders,
    morningAttendanceRows,
    offPeriodAttendanceRows,
    recentMeetingAttendanceRows,
    financeHeaders,
    upcomingMarketingEvents,
    inventorySessions,
    cfaLogs,
    upcomingCalendarEvents
  ] = await Promise.all([
    safeCount(() =>
      supabase
        .from('product_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekAgoIso)
    ),
    shiftRequestsTable
      ? safeCount(() =>
          supabase
            .from(shiftRequestsTable)
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
        )
      : Promise.resolve(0),
    shiftRequestsTable
      ? safeRows<ShiftRequestRow>(() =>
          supabase
            .from(shiftRequestsTable)
            .select(
              'id,shift_date,shift_period,shift_slot_key,from_employee_s_number,to_employee_s_number,reason,status,requested_at'
            )
            .order('requested_at', { ascending: false })
            .limit(10000)
        )
      : Promise.resolve([]),
    safeRows<ProductOrderRow>(() =>
      supabase
        .from('product_purchase_orders')
        .select('id,order_number,status,created_at,requested_pickup_date')
        .order('created_at', { ascending: false })
        .limit(10)
    ),
    morningAttendanceTable
      ? safeRows<SplitShiftAttendanceRow>(() =>
          supabase
            .from(morningAttendanceTable)
            .select('status,shift_date,shift_period,shift_slot_key,employee_s_number')
            .gte('shift_date', twoWeeksAgoDate)
            .order('shift_date', { ascending: false })
            .order('shift_period', { ascending: true })
            .limit(1500)
        )
      : Promise.resolve([]),
    offPeriodAttendanceTable
      ? safeRows<SplitShiftAttendanceRow>(() =>
          supabase
            .from(offPeriodAttendanceTable)
            .select('status,shift_date,shift_period,shift_slot_key,employee_s_number')
            .gte('shift_date', twoWeeksAgoDate)
            .order('shift_date', { ascending: false })
            .order('shift_period', { ascending: true })
            .limit(1500)
        )
      : Promise.resolve([]),
    meetingAttendanceTable
      ? safeRows<MeetingAttendanceRow>(() =>
          supabase
            .from(meetingAttendanceTable)
            .select('s_number,checkin_date,effective_status')
            .order('checkin_date', { ascending: false })
            .limit(8000)
        )
      : Promise.resolve([]),
    safeRows<FinanceHeaderRow>(() =>
      supabase
        .from('finance_report_headers')
        .select('id,report_name,status,uploaded_by,uploaded_at,total_collected')
        .order('uploaded_at', { ascending: false })
        .limit(8)
    ),
    safeRows<MarketingEventRow>(() =>
      supabase
        .from('marketing_events')
        .select('id,title,status,starts_at,updated_at')
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(8)
    ),
    safeRows<InventorySessionRow>(() =>
      supabase
        .from('inventory_sessions')
        .select('id,session_name,status,updated_at')
        .order('updated_at', { ascending: false })
        .limit(8)
    ),
    safeRows<CFAHistoryRow>(() =>
      supabase
        .from('cfa_daily_logs')
        .select('id,log_date,created_at')
        .order('created_at', { ascending: false })
        .limit(8)
    ),
    safeRows<CalendarEventRow>(() =>
      supabase
        .from('general_department_calendar_events')
        .select('id,title,starts_at,source_department')
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(6)
    )
  ]);

  const morningStats = buildAttendanceStats(morningAttendanceRows);
  const offPeriodStats = buildAttendanceStats(offPeriodAttendanceRows);
  const splitAttendanceAverageRate = averageRates([morningStats.rate, offPeriodStats.rate]);
  const splitAttendanceRateLabel = formatRatePercent(splitAttendanceAverageRate);
  const morningRateLabel = formatRatePercent(morningStats.rate);
  const offPeriodRateLabel = formatRatePercent(offPeriodStats.rate);

  const latestMorningDate = latestShiftDate(morningAttendanceRows);
  const latestMorningRows = latestMorningDate
    ? morningAttendanceRows.filter((row) => row.shift_date === latestMorningDate)
    : [];
  const latestMorningStats = buildAttendanceStats(latestMorningRows);

  const latestMorningSNumbers = Array.from(
    new Set(
      latestMorningRows
        .map((row) => row.employee_s_number)
        .filter((sNumber): sNumber is string => Boolean(sNumber))
    )
  );

  const latestMeetingDate = recentMeetingAttendanceRows
    .map((row) => row.checkin_date)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const latestMeetingRows = latestMeetingDate
    ? recentMeetingAttendanceRows.filter((row) => row.checkin_date === latestMeetingDate)
    : [];
  const latestMeetingPresentRows = latestMeetingRows.filter(
    (row) => row.effective_status === 'present' || row.effective_status === 'excused'
  );
  const latestMeetingAbsentRows = latestMeetingRows.filter((row) => row.effective_status === 'absent');
  const latestMeetingSNumbers = Array.from(
    new Set(latestMeetingRows.map((row) => row.s_number).filter((sNumber): sNumber is string => Boolean(sNumber)))
  );
  const meetingTrendSNumbers = Array.from(
    new Set(recentMeetingAttendanceRows.map((row) => row.s_number).filter((sNumber): sNumber is string => Boolean(sNumber)))
  );
  const studentLookupSNumbers = Array.from(
    new Set([
      ...latestMorningSNumbers,
      ...latestMeetingSNumbers,
      ...meetingTrendSNumbers,
      ...shiftRequestRows.map((row) => row.from_employee_s_number),
      ...shiftRequestRows.map((row) => row.to_employee_s_number)
    ])
  );

  const latestMorningStudents =
    studentLookupSNumbers.length > 0
      ? await safeRows<StudentNameRow>(() =>
          supabase
            .from('students')
            .select('*')
            .in('s_number', studentLookupSNumbers)
            .limit(3000)
        )
      : [];

  const studentBySNumber = new Map(
    latestMorningStudents
      .map((row) => ({ sNumber: resolveStudentSNumber(row), name: resolveStudentName(row) }))
      .filter((row) => row.sNumber && row.name)
      .map((row) => [row.sNumber, row.name] as const)
  );

  const latestMorningAbsentNames = latestMorningRows
    .filter((row) => row.status === 'absent')
    .map((row) => formatEmployeeName(row.employee_s_number, studentBySNumber))
    .slice(0, 6);
  const latestMorningPresentNames = latestMorningRows
    .filter((row) => row.status === 'present')
    .map((row) => formatEmployeeName(row.employee_s_number, studentBySNumber))
    .slice(0, 6);
  const latestMeetingAttendeeNames = Array.from(
    new Set(latestMeetingPresentRows.map((row) => formatEmployeeName(row.s_number, studentBySNumber)))
  );
  const latestMeetingAbsentNames = Array.from(
    new Set(latestMeetingAbsentRows.map((row) => formatEmployeeName(row.s_number, studentBySNumber)))
  );
  const latestMeetingDateLabel = latestMeetingDate ? formatDate(latestMeetingDate) : 'No recent meeting date';
  const latestMeetingValue = latestMeetingRows.length
    ? `${latestMeetingPresentRows.length}/${latestMeetingRows.length} present/excused`
    : 'No recent rows';
  const meetingDatesInWindow = Array.from(new Set(recentMeetingAttendanceRows.map((row) => row.checkin_date))).sort();
  const meetingTrendStartDate = meetingDatesInWindow[0] ?? 'No recorded meeting date';
  const meetingTrendByStudent = new Map<
    string,
    { totalMeetings: number; presentExcused: number; absent: number }
  >();
  for (const row of recentMeetingAttendanceRows) {
    const key = row.s_number;
    const current = meetingTrendByStudent.get(key) ?? { totalMeetings: 0, presentExcused: 0, absent: 0 };
    current.totalMeetings += 1;
    if (row.effective_status === 'present' || row.effective_status === 'excused') {
      current.presentExcused += 1;
    } else {
      current.absent += 1;
    }
    meetingTrendByStudent.set(key, current);
  }
  const consistentMeetingSkippers = Array.from(meetingTrendByStudent.entries())
    .map(([sNumber, stats]) => {
      const rate = stats.totalMeetings > 0 ? (stats.presentExcused / stats.totalMeetings) * 100 : 0;
      return {
        sNumber,
        name: formatEmployeeName(sNumber, studentBySNumber),
        attendanceRate: rate,
        presentExcused: stats.presentExcused,
        totalMeetings: stats.totalMeetings,
        absent: stats.absent
      };
    })
    .filter((row) => row.totalMeetings >= minMeetingsForFlag && row.attendanceRate < 50)
    .sort((left, right) => {
      if (left.attendanceRate !== right.attendanceRate) return left.attendanceRate - right.attendanceRate;
      return right.totalMeetings - left.totalMeetings;
    });
  const consistentMeetingSkipperSample = consistentMeetingSkippers
    .slice(0, 8)
    .map((row) => `${row.name} (${Math.round(row.attendanceRate)}%, ${row.presentExcused}/${row.totalMeetings})`);

  const pendingShiftRequestRows = shiftRequestRows.filter((row) => row.status === 'pending');
  const pendingShiftRequestDetails = pendingShiftRequestRows.slice(0, 20).map((row) => ({
    requesterSNumber: row.from_employee_s_number,
    requesterName: formatEmployeeName(row.from_employee_s_number, studentBySNumber),
    replacementSNumber: row.to_employee_s_number,
    replacementName: formatEmployeeName(row.to_employee_s_number, studentBySNumber),
    shiftDate: row.shift_date,
    shiftPeriod: row.shift_period,
    shiftSlotKey: row.shift_slot_key,
    requestedAt: row.requested_at,
    reason: row.reason
  }));

  const requesterStats = new Map<
    string,
    {
      totalRequests: number;
      pendingRequests: number;
      approvedRequests: number;
      deniedRequests: number;
      lastRequestedAt: string;
    }
  >();
  for (const row of shiftRequestRows) {
    const key = row.from_employee_s_number;
    if (!key) continue;
    const current = requesterStats.get(key) ?? {
      totalRequests: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      deniedRequests: 0,
      lastRequestedAt: ''
    };
    current.totalRequests += 1;
    if (row.status === 'pending') current.pendingRequests += 1;
    if (row.status === 'approved') current.approvedRequests += 1;
    if (row.status === 'denied') current.deniedRequests += 1;
    if (!current.lastRequestedAt || row.requested_at > current.lastRequestedAt) {
      current.lastRequestedAt = row.requested_at;
    }
    requesterStats.set(key, current);
  }

  const frequentRequesters = Array.from(requesterStats.entries())
    .map(([requesterSNumber, stats]) => ({
      requesterSNumber,
      requesterName: formatEmployeeName(requesterSNumber, studentBySNumber),
      totalRequests: stats.totalRequests,
      pendingRequests: stats.pendingRequests,
      approvedRequests: stats.approvedRequests,
      deniedRequests: stats.deniedRequests,
      lastRequestedAt: stats.lastRequestedAt
    }))
    .filter((row) => row.totalRequests >= 2 || row.pendingRequests >= 1)
    .sort((left, right) => {
      if (left.pendingRequests !== right.pendingRequests) return right.pendingRequests - left.pendingRequests;
      if (left.totalRequests !== right.totalRequests) return right.totalRequests - left.totalRequests;
      return right.lastRequestedAt.localeCompare(left.lastRequestedAt);
    })
    .slice(0, 20);

  const pendingRequestSample = pendingShiftRequestDetails
    .slice(0, 6)
    .map(
      (row) =>
        `${row.requesterName} -> ${row.replacementName} (${formatDate(row.shiftDate)} P${row.shiftPeriod}, requested ${formatDateTime(row.requestedAt)})`
    );
  const frequentRequesterSample = frequentRequesters
    .slice(0, 8)
    .map(
      (row) =>
        `${row.requesterName} (${row.totalRequests} total, ${row.pendingRequests} pending, last ${formatDateTime(row.lastRequestedAt)})`
    );

  const latestMorningDateLabel = latestMorningDate ? formatDate(latestMorningDate) : 'No recent shift date';
  const latestMorningValue =
    latestMorningStats.expected + latestMorningStats.present + latestMorningStats.absent + latestMorningStats.excused > 0
      ? `${latestMorningStats.present + latestMorningStats.excused}/${latestMorningStats.expected + latestMorningStats.present + latestMorningStats.absent + latestMorningStats.excused} present/excused`
      : 'No recent rows';

  const highRiskOrders = recentProductOrders.filter(
    (order) => order.status === 'ordered' || order.status === 'partially_received'
  ).length;
  const financeReportCount = financeHeaders.length;
  const totalSplitAbsences = morningStats.absent + offPeriodStats.absent;

  const summaryCards: ExecutiveSummaryCard[] = [
    {
      id: 'orders-week',
      title: 'New Product Orders (7d)',
      value: String(newOrdersThisWeek),
      subtitle: 'Placed in the last 7 days',
      tone: 'neutral'
    },
    {
      id: 'split-attendance-rate',
      title: 'Split Shift Attendance Avg',
      value: splitAttendanceRateLabel,
      subtitle: `Morning ${morningRateLabel} | Off-period ${offPeriodRateLabel}`,
      tone: totalSplitAbsences > 8 ? 'warning' : 'positive'
    },
    {
      id: 'morning-shift-recent',
      title: 'Most Recent Morning Shift',
      value: latestMorningValue,
      subtitle: `${latestMorningDateLabel} | Absent ${latestMorningStats.absent} | Excused ${latestMorningStats.excused}`,
      tone: latestMorningStats.absent > 2 ? 'warning' : 'neutral'
    },
    {
      id: 'morning-meeting-recent',
      title: 'Most Recent Morning Meeting',
      value: latestMeetingValue,
      subtitle: `${latestMeetingDateLabel} | Absent ${latestMeetingAbsentRows.length}`,
      tone: latestMeetingAbsentRows.length > 2 ? 'warning' : 'neutral'
    },
    {
      id: 'meeting-under-fifty',
      title: 'Morning Meeting Under 50%',
      value: String(consistentMeetingSkippers.length),
      subtitle: `${meetingDatesInWindow.length} meetings scanned (all available) | min ${minMeetingsForFlag} meetings`,
      tone: consistentMeetingSkippers.length > 0 ? 'warning' : 'positive'
    },
    {
      id: 'open-hr-requests',
      title: 'Open HR Requests',
      value: String(openShiftRequests),
      subtitle: 'Pending shift-change approvals',
      tone: openShiftRequests > 10 ? 'warning' : 'neutral'
    },
    {
      id: 'finance-reports',
      title: 'Recent Finance Reports',
      value: String(financeReportCount),
      subtitle: 'Most recently uploaded reports',
      tone: 'neutral'
    },
    {
      id: 'inventory-sessions',
      title: 'Inventory Sessions',
      value: String(inventorySessions.length),
      subtitle: 'Latest inventory cycle updates',
      tone: 'neutral'
    },
    {
      id: 'marketing-events',
      title: 'Upcoming Marketing Events',
      value: String(upcomingMarketingEvents.length),
      subtitle: 'Scheduled events ahead',
      tone: 'neutral'
    },
    {
      id: 'cfa-logs',
      title: 'Recent CFA Logs',
      value: String(cfaLogs.length),
      subtitle: 'Latest Chick-fil-A shift logs',
      tone: 'neutral'
    },
    {
      id: 'calendar-upcoming',
      title: 'Upcoming Calendar Items',
      value: String(upcomingCalendarEvents.length),
      subtitle: 'Cross-department deadlines/events',
      tone: 'neutral'
    }
  ];

  const feed: ExecutiveFeedItem[] = [
    ...(latestMeetingDate
      ? [
          {
            id: `feed-hr-meeting-${latestMeetingDate}`,
            department: 'HR',
            title: 'Most recent morning meeting',
            detail: `${latestMeetingDateLabel}: ${latestMeetingValue}. Attendees: ${
              latestMeetingAttendeeNames.length ? latestMeetingAttendeeNames.join(', ') : 'none listed'
            }.`,
            timestamp: formatDateTime(`${latestMeetingDate}T00:00:00.000Z`),
            severity: (latestMeetingAbsentRows.length > 2 ? 'warning' : 'info') as ExecutiveFeedItem['severity'],
            href: '/hr?module=hr&tab=meeting-attendance'
          }
        ]
      : []),
    ...(latestMorningDate
      ? [
          {
            id: `feed-hr-morning-${latestMorningDate}`,
            department: 'HR',
            title: 'Most recent morning shift',
            detail: `${latestMorningDateLabel}: ${latestMorningValue}.`,
            timestamp: formatDateTime(`${latestMorningDate}T00:00:00.000Z`),
            severity: (latestMorningStats.absent > 2 ? 'warning' : 'info') as ExecutiveFeedItem['severity'],
            href: '/hr?module=hr&tab=shift-attendance'
          }
        ]
      : []),
    ...recentProductOrders.slice(0, 3).map((order) => ({
      id: `feed-order-${order.id}`,
      department: 'Product',
      title: `Order ${order.order_number ?? order.id.slice(0, 8)} updated`,
      detail: `Status: ${order.status}. Requested pickup: ${formatDate(order.requested_pickup_date)}`,
      timestamp: formatDateTime(order.created_at),
      severity: orderSeverity(order.status),
      href: '/product'
    })),
    ...financeHeaders.slice(0, 2).map((report) => ({
      id: `feed-finance-${report.id}`,
      department: 'Finance',
      title: report.report_name,
      detail: `Status: ${report.status}. Collected: ${report.total_collected ?? 0}`,
      timestamp: formatDateTime(report.uploaded_at),
      severity: financeSeverity(report.status),
      href: '/finance'
    })),
    ...upcomingMarketingEvents.slice(0, 2).map((event) => ({
      id: `feed-marketing-${event.id}`,
      department: 'Marketing',
      title: event.title,
      detail: `Status: ${event.status}. Starts: ${formatDateTime(event.starts_at)}`,
      timestamp: formatDateTime(event.updated_at),
      severity: 'info' as const,
      href: '/marketing'
    })),
    ...inventorySessions.slice(0, 2).map((session) => ({
      id: `feed-inventory-${session.id}`,
      department: 'Inventory',
      title: session.session_name,
      detail: `Session status: ${session.status}`,
      timestamp: formatDateTime(session.updated_at),
      severity: inventorySeverity(session.status),
      href: '/inventory'
    })),
    ...cfaLogs.slice(0, 2).map((log) => ({
      id: `feed-cfa-${log.id}`,
      department: 'Chick-fil-A',
      title: `CFA daily log (${formatDate(log.log_date)})`,
      detail: `Log captured at ${formatDateTime(log.created_at)}.`,
      timestamp: formatDateTime(log.created_at),
      severity: 'info' as const,
      href: '/cfa'
    }))
  ].slice(0, 12);

  const alerts: ExecutiveAlert[] = [
    {
      id: 'alert-hr-attendance',
      title: 'Attendance Risk',
      department: 'HR',
      severity: totalSplitAbsences > 8 ? 'high' : 'medium',
      description: `Split-shift absences (morning + off-period): ${totalSplitAbsences}.`,
      action: 'Review morning/off-period attendance trends and no-shows in HR.'
    },
    {
      id: 'alert-product-orders',
      title: 'Open Product Orders',
      department: 'Product',
      severity: highRiskOrders > 6 ? 'high' : 'medium',
      description: `${highRiskOrders} orders are not fully received yet.`,
      action: 'Check high-priority purchase orders and expected arrival dates.'
    },
    {
      id: 'alert-finance',
      title: 'Finance Validation Watch',
      department: 'Finance',
      severity: financeHeaders.some((entry) => entry.status === 'failed_validation') ? 'high' : 'medium',
      description: 'At least one recent report may require validation follow-up.',
      action: 'Open finance reports and resolve validation issues.'
    }
  ];

  const metrics: ExecutiveMetric[] = [
    {
      id: 'metric-attendance',
      title: 'Split-shift attendance reliability',
      value: splitAttendanceRateLabel,
      trend: totalSplitAbsences > 8 ? 'Watch closely' : 'Stable'
    },
    {
      id: 'metric-orders',
      title: 'Order pipeline',
      value: `${recentProductOrders.length} recent orders`,
      trend: highRiskOrders > 6 ? 'Backlog risk' : 'In expected range'
    },
    {
      id: 'metric-finance',
      title: 'Finance throughput',
      value: `${financeReportCount} recent report uploads`,
      trend: financeReportCount > 0 ? 'Active' : 'No recent uploads'
    },
    {
      id: 'metric-calendar',
      title: 'Calendar load',
      value: `${upcomingCalendarEvents.length} upcoming events`,
      trend: upcomingCalendarEvents.length > 8 ? 'Potential schedule conflicts' : 'Normal load'
    }
  ];

  const reports: ExecutiveReportItem[] = [
    ...financeHeaders.slice(0, 4).map((report) => ({
      id: `report-finance-${report.id}`,
      type: 'Finance',
      title: report.report_name,
      status: report.status,
      updatedAt: formatDateTime(report.uploaded_at),
      owner: report.uploaded_by ?? 'open_access',
      href: '/finance'
    })),
    ...upcomingMarketingEvents.slice(0, 2).map((event) => ({
      id: `report-marketing-${event.id}`,
      type: 'Marketing',
      title: `Event brief: ${event.title}`,
      status: event.status,
      updatedAt: formatDateTime(event.updated_at),
      owner: 'marketing',
      href: '/marketing'
    })),
    ...cfaLogs.slice(0, 2).map((log) => ({
      id: `report-cfa-${log.id}`,
      type: 'Chick-fil-A',
      title: `Daily operations log (${formatDate(log.log_date)})`,
      status: 'captured',
      updatedAt: formatDateTime(log.created_at),
      owner: 'cfa',
      href: '/cfa'
    }))
  ];

  const departmentHealth: DepartmentHealthItem[] = [
    {
      id: 'health-hr',
      department: 'HR',
      status: totalSplitAbsences > 8 ? 'risk' : 'watch',
      summary: [
        `Most recent morning meeting (${latestMeetingDateLabel}): ${latestMeetingValue}.`,
        latestMeetingAttendeeNames.length
          ? `Attendees: ${latestMeetingAttendeeNames.join(', ')}.`
          : 'No attendee names available for the latest morning meeting.',
        latestMeetingAbsentNames.length
          ? `Meeting absences: ${latestMeetingAbsentNames.join(', ')}.`
          : 'No meeting absences listed on latest morning meeting.',
        consistentMeetingSkipperSample.length
          ? `Under 50% meeting attendance (min ${minMeetingsForFlag} meetings): ${consistentMeetingSkipperSample.join(', ')}.`
          : `No students currently below 50% meeting attendance with at least ${minMeetingsForFlag} meetings in window.`,
        `Most recent morning shift (${latestMorningDateLabel}): ${latestMorningValue}.`,
        latestMorningAbsentNames.length
          ? `Absent roster: ${latestMorningAbsentNames.join(', ')}.`
          : 'No absent roster names on most recent morning shift.',
        latestMorningPresentNames.length
          ? `Present roster sample: ${latestMorningPresentNames.join(', ')}.`
          : 'No present roster sample available.',
        `Off-period attendance rate: ${offPeriodRateLabel}.`,
        `Pending shift requests: ${openShiftRequests}.`,
        pendingRequestSample.length
          ? `Pending request details: ${pendingRequestSample.join('; ')}.`
          : 'No pending shift request details available.',
        frequentRequesterSample.length
          ? `Frequent requesters (historical): ${frequentRequesterSample.join('; ')}.`
          : 'No repeat requester pattern detected in shift-request history.'
      ].join(' ')
    },
    {
      id: 'health-product',
      department: 'Product',
      status: highRiskOrders > 6 ? 'risk' : 'watch',
      summary: `${recentProductOrders.length} recent orders, ${highRiskOrders} still open.`
    },
    {
      id: 'health-finance',
      department: 'Finance',
      status: financeHeaders.some((entry) => entry.status === 'failed_validation') ? 'watch' : 'healthy',
      summary: `${financeReportCount} recent report headers ingested.`
    },
    {
      id: 'health-marketing',
      department: 'Marketing',
      status: upcomingMarketingEvents.length === 0 ? 'watch' : 'healthy',
      summary: `${upcomingMarketingEvents.length} upcoming events in calendar.`
    },
    {
      id: 'health-inventory',
      department: 'Inventory',
      status: inventorySessions.some((entry) => entry.status === 'active') ? 'watch' : 'healthy',
      summary: `${inventorySessions.length} latest session records tracked.`
    },
    {
      id: 'health-cfa',
      department: 'Chick-fil-A',
      status: cfaLogs.length > 0 ? 'healthy' : 'watch',
      summary: `${cfaLogs.length} recent CFA shift logs found.`
    }
  ];

  const executiveBrief = [
    `Since the last 7 days, ${newOrdersThisWeek} new product orders were placed and ${openShiftRequests} HR shift requests remain pending.`,
    pendingRequestSample.length
      ? `Pending shift requests include: ${pendingRequestSample.slice(0, 3).join('; ')}.`
      : 'No detailed pending shift request rows are available right now.',
    frequentRequesterSample.length
      ? `Top historical shift-request requesters: ${frequentRequesterSample.slice(0, 3).join('; ')}.`
      : 'No high-volume shift requester pattern detected.',
    `Split-shift attendance average is ${splitAttendanceRateLabel} (morning ${morningRateLabel}, off-period ${offPeriodRateLabel}).`,
    `Most recent morning meeting (${latestMeetingDateLabel}) is ${latestMeetingValue}.`,
    `Morning meeting trend scan found ${consistentMeetingSkippers.length} student(s) below 50% attendance (min ${minMeetingsForFlag} meetings).`,
    `Most recent morning shift (${latestMorningDateLabel}) is ${latestMorningValue}.`,
    `Finance has ${financeReportCount} recent uploaded reports, while marketing has ${upcomingMarketingEvents.length} upcoming events and inventory has ${inventorySessions.length} active/recent session records.`
  ].join(' ');

  return {
    generatedAt: nowIso,
    executiveBrief,
    summaryCards,
    feed,
    alerts,
    metrics,
    reports,
    departmentHealth,
    latestMorningMeeting: {
      date: latestMeetingDate,
      dateLabel: latestMeetingDateLabel,
      presentExcusedCount: latestMeetingPresentRows.length,
      totalCount: latestMeetingRows.length,
      attendeeNames: latestMeetingAttendeeNames,
      absentNames: latestMeetingAbsentNames
    },
    morningMeetingTrend: {
      windowStartDate: meetingTrendStartDate,
      windowEndDate: meetingTrendEndDate,
      totalMeetings: meetingDatesInWindow.length,
      minMeetingsForFlag,
      underFiftyPercent: consistentMeetingSkippers.map((row) => ({
        sNumber: row.sNumber,
        name: row.name,
        attendanceRate: row.attendanceRate,
        presentExcused: row.presentExcused,
        totalMeetings: row.totalMeetings
      }))
    },
    shiftRequestInsights: {
      pendingCount: openShiftRequests,
      pendingRequests: pendingShiftRequestDetails,
      frequentRequesters
    }
  };
}

function summarizeToolResult(toolId: string, overview: ExecutiveOverviewData): string {
  switch (toolId) {
    case 'get_executive_overview':
      return overview.executiveBrief;
    case 'get_department_updates':
      return `Top feed updates loaded: ${overview.feed.slice(0, 5).map((item) => `${item.department}: ${item.title}`).join('; ')}`;
    case 'get_hr_insights': {
      const hrHealth = overview.departmentHealth.find((row) => row.department === 'HR');
      const morningCard = overview.summaryCards.find((card) => card.id === 'morning-shift-recent');
      const meetingCard = overview.summaryCards.find((card) => card.id === 'morning-meeting-recent');
      const splitCard = overview.summaryCards.find((card) => card.id === 'split-attendance-rate');
      const trend = overview.morningMeetingTrend;
      const requestInsights = overview.shiftRequestInsights;
      const trendLine =
        trend && trend.underFiftyPercent.length
          ? `Consistent morning meeting under-50% attendance (min ${trend.minMeetingsForFlag} meetings): ${trend.underFiftyPercent
              .slice(0, 12)
              .map(
                (row) =>
                  `${row.name} (${Math.round(row.attendanceRate)}%, ${row.presentExcused}/${row.totalMeetings})`
              )
              .join('; ')}.`
          : trend
            ? `No students under 50% morning meeting attendance (min ${trend.minMeetingsForFlag} meetings, ${trend.totalMeetings} meetings scanned).`
            : '';
      const pendingRequestLine =
        requestInsights && requestInsights.pendingRequests.length
          ? `Pending shift requests (${requestInsights.pendingCount}): ${requestInsights.pendingRequests
              .slice(0, 12)
              .map(
                (row) =>
                  `${row.requesterName} -> ${row.replacementName} (${formatDate(row.shiftDate)} P${row.shiftPeriod}, ${formatDateTime(row.requestedAt)})`
              )
              .join('; ')}.`
          : `Pending shift requests: ${requestInsights?.pendingCount ?? 0}.`;
      const frequentRequesterLine =
        requestInsights && requestInsights.frequentRequesters.length
          ? `Historical high-volume requesters: ${requestInsights.frequentRequesters
              .slice(0, 12)
              .map(
                (row) =>
                  `${row.requesterName} (${row.totalRequests} total, ${row.pendingRequests} pending, last ${formatDateTime(row.lastRequestedAt)})`
              )
              .join('; ')}.`
          : 'No historical high-volume shift requester pattern found.';
      return [
        hrHealth?.summary ?? 'No HR summary available.',
        splitCard ? `Split attendance: ${splitCard.value} (${splitCard.subtitle}).` : '',
        meetingCard ? `Morning meeting snapshot: ${meetingCard.value} (${meetingCard.subtitle}).` : '',
        trendLine,
        morningCard ? `Morning shift snapshot: ${morningCard.value} (${morningCard.subtitle}).` : '',
        pendingRequestLine,
        frequentRequesterLine
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'get_product_order_updates': {
      const productHealth = overview.departmentHealth.find((row) => row.department === 'Product');
      return productHealth?.summary ?? 'No product order summary available.';
    }
    case 'get_finance_report_summary': {
      const financeHealth = overview.departmentHealth.find((row) => row.department === 'Finance');
      return financeHealth?.summary ?? 'No finance summary available.';
    }
    case 'get_inventory_alerts': {
      const inventoryHealth = overview.departmentHealth.find((row) => row.department === 'Inventory');
      return inventoryHealth?.summary ?? 'No inventory summary available.';
    }
    case 'get_marketing_events_summary': {
      const marketingHealth = overview.departmentHealth.find((row) => row.department === 'Marketing');
      return marketingHealth?.summary ?? 'No marketing summary available.';
    }
    case 'get_cfa_shift_summary': {
      const cfaHealth = overview.departmentHealth.find((row) => row.department === 'Chick-fil-A');
      return cfaHealth?.summary ?? 'No CFA summary available.';
    }
    case 'get_calendar_conflicts': {
      const calendarCard = overview.summaryCards.find((card) => card.id === 'calendar-upcoming');
      return calendarCard ? `${calendarCard.value} calendar items are upcoming.` : 'No calendar summary available.';
    }
    default:
      return 'Tool completed.';
  }
}

export async function runExecutiveTooling(prompt: string): Promise<{
  toolTrace: ExecutiveToolTraceItem[];
  toolContext: string;
  overview: ExecutiveOverviewData;
}> {
  const selectedTools = planExecutiveTools(prompt).filter(
    (tool) => tool.id !== 'get_user_preferences' && tool.id !== 'sync_user_memory'
  );
  const overview = await fetchExecutiveOverview();
  const toolTrace: ExecutiveToolTraceItem[] = [];
  const contextLines: string[] = [];

  for (const tool of selectedTools) {
    const startedAt = new Date().toISOString();
    try {
      const detail = summarizeToolResult(tool.id, overview);
      const toolSpec = getToolSpecById(tool.id);
      const detailedDescription = `${toolSpec?.purpose ?? 'No purpose documented.'} Result: ${detail}`;
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: tool.id,
        label: toolSpec?.label ?? tool.id,
        status: 'complete',
        startedAt,
        finishedAt,
        detail: detailedDescription
      });
      contextLines.push([
        `[${tool.id}]`,
        `Purpose: ${toolSpec?.purpose ?? 'No purpose documented.'}`,
        `Result: ${detail}`
      ].join('\n'));
    } catch (error) {
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: tool.id,
        label: getToolSpecById(tool.id)?.label ?? tool.id,
        status: 'failed',
        startedAt,
        finishedAt,
        detail: error instanceof Error ? error.message : 'Tool execution failed.'
      });
    }
  }

  return {
    toolTrace,
    toolContext: contextLines.join('\n'),
    overview
  };
}
