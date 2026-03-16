import { createHash } from 'crypto';

import { createServerClient } from '@/lib/supabase';
import { resolvePreferredTable } from '@/lib/server/common';
import {
  detectShiftScope,
  ExecutiveDataPack,
  getToolSpecById,
  planExecutiveDataPacks,
  resolveExecutiveDateRange
} from '@/lib/executive/tooling';
import { ToolDateRange, ToolQueryFilter, ToolQueryResponse, ToolSort } from '@/lib/executive/tool-query';
import { QueryPlan, ToolCatalogEntry, ToolExecutionRecord } from '@/lib/executive/tool-query';
import { buildExecutiveToolCatalog } from '@/lib/executive/tool-catalog';

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
  tomorrowSchedule?: {
    date: string;
    totalWorkers: number;
    workers: Array<{
      sNumber: string;
      name: string;
      period: number;
      shiftSlotKey: string;
      source: string;
      isAlternate: boolean;
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

function hashRows(rows: Record<string, unknown>[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
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

function daysFromNowLocalIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

type ShiftRequestRowRaw = Record<string, unknown>;
type ShiftScheduleRow = {
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  employee_s_number: string;
  source: string | null;
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

function isAlternateShiftSlotKey(shiftSlotKey: string): boolean {
  if (!shiftSlotKey) return false;
  const normalized = shiftSlotKey.toLowerCase();
  return normalized.startsWith('manual_alt|') || /\balternate\b/.test(normalized) || /\balt\b/.test(normalized);
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

function parseNumberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeShiftRequestStatus(value: unknown): ShiftRequestRow['status'] {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'denied') return 'denied';
  return 'pending';
}

function normalizeShiftRequestRow(row: ShiftRequestRowRaw): ShiftRequestRow | null {
  const id = readStringValue(row, ['id']);
  const shiftDate = readStringValue(row, ['shift_date', 'date']);
  const requester = readStringValue(row, [
    'from_employee_s_number',
    'requester_s_number',
    'employee_s_number',
    'from_s_number'
  ]);
  const replacement = readStringValue(row, [
    'to_employee_s_number',
    'replacement_s_number',
    'to_s_number'
  ]);
  if (!id || !shiftDate || !requester) return null;

  const requestedAt = readStringValue(row, ['requested_at', 'created_at', 'updated_at']) || new Date(0).toISOString();
  const shiftSlotKey = readStringValue(row, ['shift_slot_key', 'slot_key']);
  const reason = readStringValue(row, ['reason', 'notes', 'comment']);
  return {
    id,
    shift_date: shiftDate,
    shift_period: parseNumberValue(row.shift_period, 0),
    shift_slot_key: shiftSlotKey,
    from_employee_s_number: requester,
    to_employee_s_number: replacement,
    reason,
    status: normalizeShiftRequestStatus(row.status),
    requested_at: requestedAt
  };
}

async function fetchShiftRequestRows(
  supabase: ReturnType<typeof createServerClient>,
  table: string
): Promise<{ allRows: ShiftRequestRow[]; pendingRows: ShiftRequestRow[] }> {
  const preferredColumns =
    'id,shift_date,shift_period,shift_slot_key,from_employee_s_number,to_employee_s_number,reason,status,requested_at';

  const [allPreferredResult, pendingPreferredResult] = await Promise.all([
    supabase.from(table).select(preferredColumns).order('requested_at', { ascending: false }).limit(20000),
    supabase.from(table).select(preferredColumns).eq('status', 'pending').order('requested_at', { ascending: false }).limit(500)
  ]);

  const allPreferredRows = allPreferredResult.error ? [] : (allPreferredResult.data as ShiftRequestRowRaw[] | null) ?? [];
  const pendingPreferredRows = pendingPreferredResult.error
    ? []
    : (pendingPreferredResult.data as ShiftRequestRowRaw[] | null) ?? [];

  if (allPreferredRows.length || pendingPreferredRows.length) {
    return {
      allRows: allPreferredRows.map(normalizeShiftRequestRow).filter((row): row is ShiftRequestRow => Boolean(row)),
      pendingRows: pendingPreferredRows
        .map(normalizeShiftRequestRow)
        .filter((row): row is ShiftRequestRow => Boolean(row))
    };
  }

  const [allFallbackResult, pendingFallbackResult] = await Promise.all([
    supabase.from(table).select('*').order('requested_at', { ascending: false }).limit(20000),
    supabase.from(table).select('*').eq('status', 'pending').order('requested_at', { ascending: false }).limit(500)
  ]);

  const allFallbackRows = allFallbackResult.error ? [] : (allFallbackResult.data as ShiftRequestRowRaw[] | null) ?? [];
  const pendingFallbackRows = pendingFallbackResult.error
    ? []
    : (pendingFallbackResult.data as ShiftRequestRowRaw[] | null) ?? [];

  return {
    allRows: allFallbackRows.map(normalizeShiftRequestRow).filter((row): row is ShiftRequestRow => Boolean(row)),
    pendingRows: pendingFallbackRows.map(normalizeShiftRequestRow).filter((row): row is ShiftRequestRow => Boolean(row))
  };
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

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset: Math.max(0, offset) }), 'utf8').toString('base64');
}

function decodeOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { offset?: unknown };
    const offset = Number(parsed.offset ?? 0);
    return Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
  } catch {
    return 0;
  }
}

function resolveDateColumn(dateRange: ToolDateRange | undefined, candidates: string[]): string | null {
  if (dateRange?.column) return dateRange.column;
  if (!candidates.length) return null;
  const preferred = [
    'checkin_date',
    'shift_date',
    'starts_at',
    'ends_at',
    'log_date',
    'report_date',
    'business_sales_date',
    'payout_date',
    'ach_bank_date',
    'date_placed',
    'requested_pickup_date',
    'created_at',
    'updated_at',
    'uploaded_at',
    'requested_at',
    'issued_at'
  ];
  for (const key of preferred) {
    const matched = candidates.find((candidate) => candidate === key);
    if (matched) return matched;
  }
  return candidates[0];
}

async function executeCanonicalTableQuery(params: {
  supabase: ReturnType<typeof createServerClient>;
  table: string;
  select?: string;
  filters?: ToolQueryFilter[];
  dateRange?: ToolDateRange;
  dateColumns?: string[];
  sort?: ToolSort[];
  limit?: number;
  cursor?: string | null;
}): Promise<ToolQueryResponse<Record<string, unknown>>> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = decodeOffsetCursor(params.cursor);
  const sort = (
    params.sort && params.sort.length ? params.sort : [{ column: 'id', direction: 'asc' as const }]
  ).map((entry) => ({
    column: entry.column,
    direction: entry.direction === 'desc' ? ('desc' as const) : ('asc' as const)
  }));
  const normalizedSort = sort.some((entry) => entry.column === 'id')
    ? sort
    : [...sort, { column: 'id', direction: 'asc' as const }];

  let query = params.supabase
    .from(params.table)
    .select(params.select ?? '*')
    .range(offset, offset + limit);

  for (const filter of params.filters ?? []) {
    const op = filter.op;
    if (op === 'eq') query = query.eq(filter.column, filter.value as never);
    else if (op === 'neq') query = query.neq(filter.column, filter.value as never);
    else if (op === 'in' && Array.isArray(filter.value)) query = query.in(filter.column, filter.value as never[]);
    else if (op === 'nin' && Array.isArray(filter.value)) query = query.not(filter.column, 'in', `(${filter.value.join(',')})`);
    else if (op === 'gt') query = query.gt(filter.column, filter.value as never);
    else if (op === 'gte') query = query.gte(filter.column, filter.value as never);
    else if (op === 'lt') query = query.lt(filter.column, filter.value as never);
    else if (op === 'lte') query = query.lte(filter.column, filter.value as never);
    else if (op === 'ilike') query = query.ilike(filter.column, String(filter.value ?? ''));
    else if (op === 'contains') query = query.contains(filter.column, filter.value as never);
    else if (op === 'is') query = query.is(filter.column, (filter.value ?? null) as never);
  }

  const dateColumn = resolveDateColumn(params.dateRange, params.dateColumns ?? []);
  if (dateColumn) {
    if (params.dateRange?.from) query = query.gte(dateColumn, params.dateRange.from);
    if (params.dateRange?.to) query = query.lte(dateColumn, params.dateRange.to);
  }

  for (const entry of normalizedSort) {
    query = query.order(entry.column, { ascending: entry.direction !== 'desc' });
  }

  const result = await query;
  const rows = result.error ? [] : (((result.data ?? []) as unknown) as Record<string, unknown>[]);
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  return {
    table: params.table,
    row_count: sliced.length,
    rows: sliced,
    next_cursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    has_more: hasMore,
    applied_sort: normalizedSort,
    effective_window:
      dateColumn && (params.dateRange?.from || params.dateRange?.to)
        ? {
            column: dateColumn,
            from: params.dateRange?.from,
            to: params.dateRange?.to
          }
        : null,
    offset,
    limit
  };
}

const PACK_TABLES: Record<ExecutiveDataPack, Array<{ table: string; dateColumns: string[] }>> = {
  executive_overview: [
    { table: 'product_purchase_orders', dateColumns: ['created_at', 'requested_pickup_date'] },
    { table: 'finance_report_headers', dateColumns: ['uploaded_at', 'created_at'] },
    { table: 'marketing_events', dateColumns: ['starts_at', 'updated_at'] },
    { table: 'inventory_sessions', dateColumns: ['updated_at', 'created_at'] },
    { table: 'general_department_calendar_events', dateColumns: ['starts_at', 'created_at'] }
  ],
  hr_deep_dive: [
    { table: 'hr_shift_attendance', dateColumns: ['shift_date'] },
    { table: 'shift_attendance', dateColumns: ['shift_date'] },
    { table: 'hr_shift_change_requests', dateColumns: ['requested_at', 'shift_date'] },
    { table: 'shift_change_requests', dateColumns: ['requested_at', 'shift_date'] },
    { table: 'hr_meeting_attendance_records', dateColumns: ['checkin_date', 'created_at'] },
    { table: 'meeting_attendance_records', dateColumns: ['checkin_date', 'created_at'] },
    { table: 'hr_strikes', dateColumns: ['issued_at', 'created_at'] },
    { table: 'strikes', dateColumns: ['issued_at', 'created_at'] },
    { table: 'hr_strike_appeals', dateColumns: ['requested_at', 'created_at'] },
    { table: 'strike_appeals', dateColumns: ['requested_at', 'created_at'] },
    { table: 'hr_points_ledger', dateColumns: ['created_at'] },
    { table: 'points_ledger', dateColumns: ['created_at'] },
    { table: 'students', dateColumns: ['created_at'] }
  ],
  product_ops_deep_dive: [
    { table: 'product_purchase_orders', dateColumns: ['created_at', 'updated_at', 'date_placed'] },
    { table: 'product_purchase_order_lines', dateColumns: ['created_at'] },
    { table: 'product_receipts', dateColumns: ['created_at'] },
    { table: 'product_receipt_lines', dateColumns: ['created_at'] },
    { table: 'product_order_prompts', dateColumns: ['created_at'] },
    { table: 'product_attachments', dateColumns: ['created_at'] },
    { table: 'product_purchase_order_attachments', dateColumns: ['created_at'] },
    { table: 'product_purchase_order_line_attachments', dateColumns: ['created_at'] },
    { table: 'product_designs', dateColumns: ['created_at', 'updated_at'] },
    { table: 'product_wishlist_items', dateColumns: ['created_at', 'updated_at'] },
    { table: 'product_inventory_levels', dateColumns: ['updated_at'] },
    { table: 'product_inventory_snapshot_lines', dateColumns: ['created_at'] },
    { table: 'product_inventory_uploads', dateColumns: ['uploaded_at'] },
    { table: 'product_products', dateColumns: ['created_at', 'updated_at'] },
    { table: 'product_vendors', dateColumns: ['created_at', 'updated_at'] },
    { table: 'product_categories', dateColumns: ['created_at', 'updated_at'] },
    { table: 'product_settings', dateColumns: ['created_at', 'updated_at'] }
  ],
  marketing_deep_dive: [
    { table: 'marketing_events', dateColumns: ['starts_at', 'updated_at', 'created_at'] },
    { table: 'external_contacts', dateColumns: ['created_at', 'updated_at'] },
    { table: 'internal_coordinators', dateColumns: ['created_at', 'updated_at'] },
    { table: 'event_contacts', dateColumns: ['created_at'] },
    { table: 'event_assets', dateColumns: ['created_at'] },
    { table: 'event_notes', dateColumns: ['created_at'] },
    { table: 'coordination_logs', dateColumns: ['created_at'] },
    { table: 'marketing_reports', dateColumns: ['report_date', 'created_at', 'updated_at'] },
    { table: 'marketing_event_categories', dateColumns: ['created_at', 'updated_at'] }
  ],
  finance_deep_dive: [
    { table: 'finance_report_headers', dateColumns: ['uploaded_at', 'created_at', 'updated_at'] },
    { table: 'finance_report_rows', dateColumns: ['business_sales_date', 'payout_date', 'ach_bank_date', 'created_at'] },
    { table: 'finance_report_issues', dateColumns: ['created_at'] },
    { table: 'finance_report_activity_log', dateColumns: ['created_at'] },
    { table: 'finance_report_config', dateColumns: ['updated_at'] }
  ],
  inventory_deep_dive: [
    { table: 'Inventory', dateColumns: ['date'] },
    { table: 'inventory_sessions', dateColumns: ['updated_at', 'created_at'] },
    { table: 'inventory_session_events', dateColumns: ['created_at'] },
    { table: 'inventory_session_participants', dateColumns: ['created_at'] },
    { table: 'inventory_session_final', dateColumns: ['created_at'] },
    { table: 'inventory_session_snapshots', dateColumns: ['created_at'] },
    { table: 'inventory_manual_overrides', dateColumns: ['created_at'] },
    { table: 'inventory_upload_runs', dateColumns: ['created_at'] },
    { table: 'inventory_checks', dateColumns: ['starts_at', 'ends_at', 'created_at', 'updated_at'] },
    { table: 'inventory_check_signups', dateColumns: ['updated_at'] },
    { table: 'inventory_check_change_requests', dateColumns: ['requested_at'] },
    { table: 'inventory_check_audit_log', dateColumns: ['created_at'] }
  ],
  cfa_deep_dive: [
    { table: 'cfa_daily_logs', dateColumns: ['log_date', 'created_at', 'updated_at'] },
    { table: 'cfa_daily_log_lines', dateColumns: ['created_at', 'updated_at'] },
    { table: 'cfa_items', dateColumns: ['created_at', 'updated_at'] }
  ],
  calendar_deep_dive: [{ table: 'general_department_calendar_events', dateColumns: ['starts_at', 'ends_at', 'created_at'] }],
  access_deep_dive: [
    { table: 'access_permissions', dateColumns: ['created_at', 'updated_at'] },
    { table: 'access_roles', dateColumns: ['created_at', 'updated_at'] },
    { table: 'access_role_permissions', dateColumns: ['created_at'] },
    { table: 'employee_role_assignments', dateColumns: ['created_at'] },
    { table: 'employee_permission_overrides', dateColumns: ['created_at'] },
    { table: 'auth_sessions', dateColumns: ['created_at'] }
  ]
};

function buildQueryPlan(prompt: string, selectedPacks: ExecutiveDataPack[]): QueryPlan {
  const normalized = prompt.toLowerCase();
  const asksAttendance = ['attendance', 'morning meeting', 'meeting attendance', 'shift'].some((term) =>
    normalized.includes(term)
  );
  const asksAnalyticalAttendance = ['who', 'below', 'between', 'trend', 'patterns', 'pattern', 'most', 'least', 'last', 'past'].some(
    (term) => normalized.includes(term)
  );
  const isAttendanceDetail = asksAttendance && asksAnalyticalAttendance;
  const asksMeeting = normalized.includes('morning meeting') || normalized.includes('meeting attendance');
  const asksShift = normalized.includes('shift') || normalized.includes('shift attendance') || normalized.includes('morning shift');
  const shiftScope = detectShiftScope(prompt);

  const forcedAttendanceTables: string[] = [];
  if (isAttendanceDetail && asksMeeting) {
    forcedAttendanceTables.push('table_hr_meeting_attendance_records', 'table_meeting_attendance_records', 'table_students');
  }
  if (isAttendanceDetail && asksShift) {
    if (shiftScope === 'off_period') {
      forcedAttendanceTables.push('table_hr_off_period_shift_attendance', 'table_off_period_shift_attendance', 'table_students');
    } else if (shiftScope === 'morning') {
      forcedAttendanceTables.push('table_hr_morning_shift_attendance', 'table_morning_shift_attendance', 'table_students');
    } else {
      forcedAttendanceTables.push('table_hr_shift_attendance', 'table_shift_attendance', 'table_students');
    }
  }
  const uniqueForcedTables = Array.from(new Set(forcedAttendanceTables));
  const targetEntities = Array.from(
    new Set(
      [
        asksMeeting ? 'morning_meeting' : null,
        asksShift ? 'shift_attendance' : null,
        asksShift ? `shift_scope:${shiftScope}` : null
      ].filter(Boolean)
    )
  ) as string[];

  const selectedTools = [
    ...selectedPacks,
    ...uniqueForcedTables
  ];
  return {
    intentClass: isAttendanceDetail ? 'attendance_detail' : selectedPacks.length ? 'overview' : 'general',
    selectedTools,
    dateRange: selectedPacks.length ? resolveExecutiveDateRange(prompt, selectedPacks[0]) : { mode: 'auto' },
    filters: [],
    sort: [{ column: 'id', direction: 'asc' }],
    limit: isAttendanceDetail ? 2000 : 50,
    targetEntities: isAttendanceDetail ? targetEntities : []
  };
}

export async function fetchExecutiveOverview(): Promise<ExecutiveOverviewData> {
  const supabase = createServerClient();
  const nowIso = new Date().toISOString();
  const weekAgoIso = daysAgoIso(7);
  const twoWeeksAgoDate = daysAgoIso(14).slice(0, 10);
  const tomorrowDate = daysFromNowLocalIsoDate(1);
  const meetingTrendEndDate = nowIso.slice(0, 10);
  const minMeetingsForFlag = 3;

  const [shiftRequestsTable, shiftAttendanceTable, morningAttendanceTable, offPeriodAttendanceTable, meetingAttendanceTable] =
    await Promise.all([
      resolveTableOrNull(supabase, 'hr_shift_change_requests', 'shift_change_requests'),
      resolveTableOrNull(supabase, 'hr_shift_attendance', 'shift_attendance', 'shift_date'),
      resolveTableOrNull(supabase, 'hr_morning_shift_attendance', 'morning_shift_attendance', 'shift_date'),
      resolveTableOrNull(supabase, 'hr_off_period_shift_attendance', 'off_period_shift_attendance', 'shift_date'),
      resolveTableOrNull(supabase, 'hr_meeting_attendance_records', 'meeting_attendance_records', 'checkin_date')
    ]);

  const [
    newOrdersThisWeek,
    openShiftRequests,
    shiftRequestRowsSet,
    tomorrowScheduleRows,
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
      ? fetchShiftRequestRows(supabase, shiftRequestsTable)
      : Promise.resolve({ allRows: [], pendingRows: [] }),
    shiftAttendanceTable
      ? safeRows<ShiftScheduleRow>(() =>
          supabase
            .from(shiftAttendanceTable)
            .select('shift_date,shift_period,shift_slot_key,employee_s_number,source')
            .eq('shift_date', tomorrowDate)
            .in('source', ['scheduler', 'shift_exchange'])
            .order('shift_period', { ascending: true })
            .limit(6000)
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
            .lte('checkin_date', meetingTrendEndDate)
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

  const shiftRequestRows = shiftRequestRowsSet.allRows;
  const pendingShiftRequestRows = shiftRequestRowsSet.pendingRows.length
    ? shiftRequestRowsSet.pendingRows
    : shiftRequestRows.filter((row) => row.status === 'pending');

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
      ...tomorrowScheduleRows.map((row) => row.employee_s_number),
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
  const tomorrowWorkers = tomorrowScheduleRows
    .map((row) => ({
      sNumber: row.employee_s_number,
      name: formatEmployeeName(row.employee_s_number, studentBySNumber),
      period: Number(row.shift_period ?? 0),
      shiftSlotKey: String(row.shift_slot_key ?? ''),
      source: String(row.source ?? 'scheduler')
    }))
    .map((row) => ({
      ...row,
      isAlternate: isAlternateShiftSlotKey(row.shiftSlotKey)
    }))
    .filter((row) => row.sNumber && row.period > 0)
    .sort((left, right) => {
      if (left.period !== right.period) return left.period - right.period;
      if (left.name !== right.name) return left.name.localeCompare(right.name);
      return left.sNumber.localeCompare(right.sNumber);
    });
  const tomorrowWorkerSample = tomorrowWorkers
    .slice(0, 10)
    .map((row) => `${row.name} (P${row.period})`);
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
        `Tomorrow schedule (${tomorrowDate}): ${tomorrowWorkers.length} scheduled worker-slot assignments.`,
        tomorrowWorkerSample.length
          ? `Tomorrow roster sample: ${tomorrowWorkerSample.join(', ')}.`
          : 'No tomorrow roster rows found in schedule-backed attendance.',
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
    `Tomorrow schedule (${tomorrowDate}) has ${tomorrowWorkers.length} scheduled worker-slot assignments.`,
    tomorrowWorkerSample.length
      ? `Tomorrow roster sample: ${tomorrowWorkerSample.slice(0, 6).join(', ')}.`
      : 'No tomorrow schedule roster rows found right now.',
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
    },
    tomorrowSchedule: {
      date: tomorrowDate,
      totalWorkers: tomorrowWorkers.length,
      workers: tomorrowWorkers.slice(0, 200)
    }
  };
}

function summarizeToolResult(toolId: string, overview: ExecutiveOverviewData): string {
  switch (toolId) {
    case 'executive_overview':
      return overview.executiveBrief;
    case 'hr_deep_dive': {
      const hrHealth = overview.departmentHealth.find((row) => row.department === 'HR');
      const morningCard = overview.summaryCards.find((card) => card.id === 'morning-shift-recent');
      const meetingCard = overview.summaryCards.find((card) => card.id === 'morning-meeting-recent');
      const splitCard = overview.summaryCards.find((card) => card.id === 'split-attendance-rate');
      const trend = overview.morningMeetingTrend;
      const requestInsights = overview.shiftRequestInsights;
      const tomorrowSchedule = overview.tomorrowSchedule;
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
      const tomorrowScheduleLine =
        tomorrowSchedule && tomorrowSchedule.workers.length
          ? `Tomorrow schedule (${tomorrowSchedule.date}) workers: ${tomorrowSchedule.workers
              .slice(0, 20)
              .map((row) => `${row.name} (P${row.period})`)
              .join('; ')}.`
          : `Tomorrow schedule: no worker rows found for ${tomorrowSchedule?.date ?? 'tomorrow'}.`;
      return [
        hrHealth?.summary ?? 'No HR summary available.',
        splitCard ? `Split attendance: ${splitCard.value} (${splitCard.subtitle}).` : '',
        meetingCard ? `Morning meeting snapshot: ${meetingCard.value} (${meetingCard.subtitle}).` : '',
        trendLine,
        morningCard ? `Morning shift snapshot: ${morningCard.value} (${morningCard.subtitle}).` : '',
        tomorrowScheduleLine,
        pendingRequestLine,
        frequentRequesterLine
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'product_ops_deep_dive': {
      const productHealth = overview.departmentHealth.find((row) => row.department === 'Product');
      return productHealth?.summary ?? 'No product order summary available.';
    }
    case 'finance_deep_dive': {
      const financeHealth = overview.departmentHealth.find((row) => row.department === 'Finance');
      return financeHealth?.summary ?? 'No finance summary available.';
    }
    case 'inventory_deep_dive': {
      const inventoryHealth = overview.departmentHealth.find((row) => row.department === 'Inventory');
      return inventoryHealth?.summary ?? 'No inventory summary available.';
    }
    case 'marketing_deep_dive': {
      const marketingHealth = overview.departmentHealth.find((row) => row.department === 'Marketing');
      return marketingHealth?.summary ?? 'No marketing summary available.';
    }
    case 'cfa_deep_dive': {
      const cfaHealth = overview.departmentHealth.find((row) => row.department === 'Chick-fil-A');
      return cfaHealth?.summary ?? 'No CFA summary available.';
    }
    case 'calendar_deep_dive': {
      const calendarCard = overview.summaryCards.find((card) => card.id === 'calendar-upcoming');
      return calendarCard ? `${calendarCard.value} calendar items are upcoming.` : 'No calendar summary available.';
    }
    case 'access_deep_dive':
      return 'Access control and RBAC datasets were queried for role/permission visibility.';
    default:
      return 'Tool completed.';
  }
}

export async function runExecutiveTooling(prompt: string): Promise<{
  toolTrace: ExecutiveToolTraceItem[];
  toolContext: string;
  overview: ExecutiveOverviewData;
  toolCatalog: ToolCatalogEntry[];
  queryPlan: QueryPlan;
  executionRecords: ToolExecutionRecord[];
}> {
  const selectedPacks = planExecutiveDataPacks(prompt);
  const overview = await fetchExecutiveOverview();
  const toolCatalog = buildExecutiveToolCatalog();
  const queryPlan = buildQueryPlan(prompt, selectedPacks);
  const toolTrace: ExecutiveToolTraceItem[] = [];
  const contextLines: string[] = [];
  const executionRecords: ToolExecutionRecord[] = [];
  const supabase = createServerClient();

  for (const pack of selectedPacks) {
    if (queryPlan.intentClass === 'attendance_detail' && pack === 'hr_deep_dive') {
      continue;
    }
    const startedAt = new Date().toISOString();
    try {
      const dateRange = resolveExecutiveDateRange(prompt, pack);
      const tableEntries = PACK_TABLES[pack] ?? [];
      const tableSummaries: string[] = [];

      for (const entry of tableEntries) {
        const queryResult = await executeCanonicalTableQuery({
          supabase,
          table: entry.table,
          dateRange,
          dateColumns: entry.dateColumns,
          sort: [{ column: entry.dateColumns[0] ?? 'id', direction: 'desc' }, { column: 'id', direction: 'asc' }],
          limit: 50
        });
        executionRecords.push({
          toolId: `table_${entry.table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
          table: entry.table,
          args: {
            dateRange,
            filters: [],
            sort: [{ column: entry.dateColumns[0] ?? 'id', direction: 'desc' }, { column: 'id', direction: 'asc' }],
            limit: 50
          },
          rowCount: queryResult.row_count,
          rowHash: hashRows(queryResult.rows),
          effectiveWindow: queryResult.effective_window,
          rows: queryResult.rows
        });
        tableSummaries.push(
          `${entry.table}: ${queryResult.row_count} rows` +
            (queryResult.effective_window
              ? ` (${queryResult.effective_window.column} ${queryResult.effective_window.from ?? ''} -> ${queryResult.effective_window.to ?? ''})`
              : '')
        );
      }

      const detail =
        `${summarizeToolResult(pack, overview)} ` +
        (tableSummaries.length ? `Canonical table coverage: ${tableSummaries.join('; ')}.` : 'No table entries configured.');
      const toolSpec = getToolSpecById(pack);
      const detailedDescription = `${toolSpec?.purpose ?? 'No purpose documented.'} Result: ${detail}`;
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: pack,
        label: toolSpec?.label ?? pack,
        status: 'complete',
        startedAt,
        finishedAt,
        detail: detailedDescription
      });
      contextLines.push([
        `[${pack}]`,
        `Purpose: ${toolSpec?.purpose ?? 'No purpose documented.'}`,
        `Result: ${detail}`
      ].join('\n'));
    } catch (error) {
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: pack,
        label: getToolSpecById(pack)?.label ?? pack,
        status: 'failed',
        startedAt,
        finishedAt,
        detail: error instanceof Error ? error.message : 'Tool execution failed.'
      });
    }
  }

  if (queryPlan.intentClass === 'attendance_detail') {
    const asksMeeting = queryPlan.targetEntities.includes('morning_meeting');
    const shiftScopeEntity = queryPlan.targetEntities.find((entity) => entity.startsWith('shift_scope:'));
    const shiftScope = (shiftScopeEntity?.split(':')[1] ?? 'any') as 'morning' | 'off_period' | 'any';
    const asksShift = queryPlan.targetEntities.includes('shift_attendance');

    const attendanceTables: Array<{ table: string; dateColumns: string[] }> = [];
    if (asksMeeting) {
      attendanceTables.push(
        { table: 'hr_meeting_attendance_records', dateColumns: ['checkin_date', 'created_at'] },
        { table: 'meeting_attendance_records', dateColumns: ['checkin_date', 'created_at'] }
      );
    }
    if (asksShift) {
      if (shiftScope === 'off_period') {
        attendanceTables.push(
          { table: 'hr_off_period_shift_attendance', dateColumns: ['shift_date'] },
          { table: 'off_period_shift_attendance', dateColumns: ['shift_date'] }
        );
      } else if (shiftScope === 'morning') {
        attendanceTables.push(
          { table: 'hr_morning_shift_attendance', dateColumns: ['shift_date'] },
          { table: 'morning_shift_attendance', dateColumns: ['shift_date'] }
        );
      } else {
        attendanceTables.push(
          { table: 'hr_shift_attendance', dateColumns: ['shift_date'] },
          { table: 'shift_attendance', dateColumns: ['shift_date'] }
        );
      }
    }
    attendanceTables.push({ table: 'students', dateColumns: ['created_at'] });
    const uniqueAttendanceTables = attendanceTables.filter(
      (entry, index, all) => all.findIndex((candidate) => candidate.table === entry.table) === index
    );
    const dateRange = queryPlan.dateRange.mode === 'explicit' ? queryPlan.dateRange : resolveExecutiveDateRange(prompt, 'hr_deep_dive');
    for (const entry of uniqueAttendanceTables) {
      const isStudentDirectoryTable = entry.table === 'students';
      const queryDateRange = isStudentDirectoryTable ? undefined : dateRange;
      const queryDateColumns = isStudentDirectoryTable ? [] : entry.dateColumns;
      const sortColumn = isStudentDirectoryTable ? 'id' : (entry.dateColumns[0] ?? 'id');
      const startedAt = new Date().toISOString();
      try {
        const queryResult = await executeCanonicalTableQuery({
          supabase,
          table: entry.table,
          dateRange: queryDateRange,
          dateColumns: queryDateColumns,
          sort: [{ column: sortColumn, direction: 'desc' }, { column: 'id', direction: 'asc' }],
          limit: 6000
        });
        const finishedAt = new Date().toISOString();
        executionRecords.push({
          toolId: `table_${entry.table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
          table: entry.table,
          args: {
            dateRange: queryDateRange,
            filters: [],
            sort: [{ column: sortColumn, direction: 'desc' }, { column: 'id', direction: 'asc' }],
            limit: 6000
          },
          rowCount: queryResult.row_count,
          rowHash: hashRows(queryResult.rows),
          effectiveWindow: queryResult.effective_window,
          rows: queryResult.rows
        });
        toolTrace.push({
          id: `table_${entry.table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
          label: entry.table,
          status: 'complete',
          startedAt,
          finishedAt,
          detail: `Fetched ${queryResult.row_count} row(s) for attendance validation from ${entry.table}.`
        });
      } catch (error) {
        const finishedAt = new Date().toISOString();
        toolTrace.push({
          id: `table_${entry.table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
          label: entry.table,
          status: 'failed',
          startedAt,
          finishedAt,
          detail: error instanceof Error ? error.message : `Failed querying ${entry.table}`
        });
      }
    }
  }

  return {
    toolTrace,
    toolContext: contextLines.join('\n'),
    overview,
    toolCatalog,
    queryPlan,
    executionRecords
  };
}
