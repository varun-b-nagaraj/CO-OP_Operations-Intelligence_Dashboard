export type PermissionFlag =
  | 'hr.schedule.view'
  | 'hr.schedule.edit'
  | 'hr.strikes.manage'
  | 'hr.attendance.view'
  | 'hr.attendance.override'
  | 'hr.requests.view'
  | 'hr.audit.view'
  | 'hr.settings.edit'
  | 'cfa.logs.read'
  | 'cfa.logs.write'
  | 'cfa.menu.manage'
  | 'cfa.day_type.override'
  | 'cfa.exports';

export type Role = 'employee' | 'manager' | 'HR_lead' | 'exec';

export interface UserContext {
  id: string | null;
  role: Role | null;
  permissions: PermissionFlag[];
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXTERNAL_API_ERROR'
  | 'DB_ERROR'
  | 'UNKNOWN_ERROR';

export type Result<T> =
  | { ok: true; data: T; correlationId: string }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        fieldErrors?: Record<string, string>;
      };
      correlationId: string;
    };

export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function successResult<T>(data: T, correlationId: string): Result<T> {
  return { ok: true, data, correlationId };
}

export function errorResult<T>(
  correlationId: string,
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string>
): Result<T> {
  return { ok: false, error: { code, message, fieldErrors }, correlationId };
}

export interface Employee {
  id: string;
  name: string;
  s_number: string;
  username?: string | null;
  assigned_periods?: string | null;
}

export interface Strike {
  id: string;
  employee_id: string;
  reason: string;
  issued_by: string | null;
  issued_at: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AttendanceOverride {
  id: string;
  s_number: string;
  checkin_date: string;
  scope: 'meeting' | 'shift';
  shift_period: number | null;
  override_type: 'excused' | 'present_override';
  reason: string;
  overridden_by: string | null;
  overridden_at: string;
}

export type ShiftRequestStatus = 'pending' | 'approved' | 'denied';
export type ShiftRequestSource = 'employee_form' | 'manager_schedule' | 'system';

export interface ShiftChangeRequest {
  id: string;
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  from_employee_s_number: string;
  to_employee_s_number: string;
  reason: string;
  status: ShiftRequestStatus;
  request_source: ShiftRequestSource;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export type PointType = 'meeting' | 'morning_shift' | 'off_period_shift' | 'project' | 'manual';

export interface PointsEntry {
  id: string;
  employee_id: string;
  point_type: PointType;
  points: number;
  description: string | null;
  awarded_by: string | null;
  awarded_at: string;
}

export interface EmployeeSettings {
  id: string;
  employee_id: string;
  employee_s_number: string;
  off_periods: number[];
  created_at: string;
  updated_at: string;
}

export interface EmployeeLoginProfile {
  employee_id: string;
  username: string;
  password_updated_at: string;
}

export type ShiftAttendanceStatus = 'expected' | 'present' | 'absent' | 'excused';
export type ShiftAttendanceSource = 'scheduler' | 'manual' | 'shift_exchange' | 'rebuild';

export interface ShiftAttendance {
  id: string;
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  employee_s_number: string;
  status: ShiftAttendanceStatus;
  source: ShiftAttendanceSource;
  reason: string | null;
  marked_by: string | null;
  marked_at: string;
}

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  timestamp: string;
}

export interface ScheduleParams {
  year: number;
  month: number;
  anchorDate: string;
  anchorDay: 'A' | 'B';
  seed: number;
  forceRefresh?: boolean;
  forceRebuildExpectedShifts?: boolean;
}

export interface ScheduleAPIResponse {
  meta: {
    year: number;
    month: number;
    anchorDate: string;
    anchorDay: 'A' | 'B';
    seed: number;
    generatedAt: string;
    regularsPerShift: number;
    alternatesPerShift: number;
  };
  roster: Array<{
    id: number | string;
    name: string;
    s_number: string;
    scheduleable: boolean;
    Schedule: number;
  }>;
  calendar: Record<string, 'A' | 'B'>;
  schedule: Array<{
    Date: string;
    Day: string;
    Period: number;
    Student: string;
    Type: string;
    Group: string;
    Role: string;
  }>;
  summary: Array<{
    Student: string;
    Role: string;
    Group: string;
    'Regular Shifts': number;
    'Alternate Shifts': number;
    'Total Shifts': number;
    'Periods Worked': string;
  }>;
  statistics: Array<{ Metric: string; Value: number | string }>;
  balanceAnalysis: Array<{ Category: string; Metric: string; Value: number | string }>;
}

export interface ScheduleAssignment {
  date: string;
  day: string;
  period: number;
  shiftSlotKey: string;
  studentName: string;
  studentSNumber: string;
  type: string;
  group: string;
  role: string;
  effectiveWorkerSNumber: string;
}

export interface NormalizedScheduleResponse {
  meta: ScheduleAPIResponse['meta'];
  roster: ScheduleAPIResponse['roster'];
  calendar: Record<string, 'A' | 'B'>;
  schedule: ScheduleAssignment[];
  summary: Array<{
    student: string;
    studentSNumber: string;
    role: string;
    group: string;
    regularShifts: number;
    alternateShifts: number;
    totalShifts: number;
    periodsWorked: string;
  }>;
  statistics: Array<{ metric: string; value: number | string }>;
  balanceAnalysis: Array<{ category: string; metric: string; value: number | string }>;
}

export interface MeetingAttendanceParams {
  date?: string;
  from?: string;
  to?: string;
  exclude?: string;
}

export interface MeetingAttendanceRecord {
  s_number: string;
  date: string;
  status: 'present' | 'absent';
}

export interface MeetingAttendanceResponse {
  ok: boolean;
  dates: string[];
  meta: {
    timezone: string;
    generated_at: string;
    filters: {
      date?: string;
      from?: string;
      to?: string;
      exclude?: string | string[];
    };
  };
  analytics: {
    total_students: number;
    total_sessions: number;
    avg_attendance: number;
    students: Array<{
      name: string;
      s_number: string;
      present_count: number;
      absent_count: number;
      attendance_rate: number;
      raw_attendance_rate?: number | null;
      adjusted_attendance_rate?: number | null;
      excused_count?: number;
    }>;
  };
  sessions: Array<{
    date: string;
    present_count: number;
    absent_count: number;
    total_students: number;
    attendance_rate: number;
  }>;
  records: MeetingAttendanceRecord[];
  roster: Array<{ name: string; s_number: string }>;
}

export interface ShiftAttendanceFilters {
  from?: string;
  to?: string;
  employeeSNumber?: string;
  period?: number;
  status?: ShiftAttendanceStatus;
}

export interface PointsBreakdown {
  total: number;
  byType: Record<PointType, number>;
}

export type CFADayType = 'A' | 'B';

export interface CFAItem {
  item_id: string;
  name: string;
  buy_cost_cents: number;
  sell_price_cents: number;
  active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CFADailyLog {
  id: string;
  log_date: string;
  day_type: CFADayType;
  period: number;
  total_revenue_cents: number;
  total_cogs_cents: number;
  total_profit_cents: number;
  stockout_flag: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CFADailyLogLine {
  id: string;
  log_id: string;
  item_id: string;
  received_qty: number;
  leftover_qty: number;
  missed_demand_qty: number;
  sold_qty: number;
  true_demand_qty: number;
  sell_price_cents: number;
  buy_cost_cents: number;
  revenue_cents: number;
  cogs_cents: number;
  profit_cents: number;
  margin_pct: number | null;
  created_at: string;
  updated_at: string;
}
