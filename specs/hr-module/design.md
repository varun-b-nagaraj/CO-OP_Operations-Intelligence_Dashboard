# Design Document: HR Module

## Overview

The HR Module is a single-page Next.js application that provides comprehensive human resources management for a 100-member student CO-OP organization. The system integrates with two external APIs (Scheduling for shift assignments, Meeting Attendance for bi-weekly meeting check-ins) and uses Supabase PostgreSQL for data persistence. The architecture is designed for v1 open-access deployment while maintaining a permission-ready structure for future role-based access control.

### Key Design Principles

1. **Single Page Architecture**: All features accessible via tabs at /hr route
2. **Dual Attendance Systems**: Separate tracking for meeting attendance (external API) and shift attendance (internal)
3. **Employee-Specific Off-Periods**: Off-period classification based on individual employee schedules, not global periods
4. **Shift Exchange Model**: Track shift reassignments with from/to employees, slot identity (shift_slot_key), and expected worker updates
5. **Permission-Ready**: All features behind permission gates (allow-all in v1)
6. **Server-Side Security Boundary**: Writes and external API calls via Next.js route handlers
7. **Client-Side Reads**: Direct Supabase queries with RLS (allow-all in v1)
8. **Minimal UI**: Maroon (#800000) accents, rectangular corners (border-radius: 0), minimal palette, subtle animations (<200ms)
9. **Responsive & Accessible**: Mobile-friendly layouts, semantic HTML, keyboard navigation, visible focus states

### Attendance Model Clarification

The system tracks TWO distinct attendance types:

**Meeting Attendance**:
- Source: Meeting Attendance API (external)
- Frequency: Every other Thursday (morning meetings)
- Tracks: Check-ins for organizational meetings
- Overrides: attendance_overrides with scope='meeting'

**Shift Attendance**:
- Source: shift_attendance table (internal)
- Frequency: Daily shifts across periods 0-8
- Tracks: Attendance at scheduled work shifts
- Expected workers: Derived from Scheduling API + approved shift exchanges
- Excusals: handled directly by updating shift_attendance.status to 'excused' in v1
- attendance_overrides(scope='shift') is reserved for future shift attendance overrides (not used in v1)

**Important**: Bi-weekly morning meeting attendance (Meeting Attendance API) and period 0 "morning shift" attendance (shift_attendance.shift_period=0) are separate systems. They do not overlap and should not double-award points.

## Architecture

### System Architecture Diagram

```mermaid
graph TB
    subgraph "Client (Browser)"
        UI[React UI Components]
        State[React State + React Query]
        SupaClient[Supabase Client<br/>Anon Key]
    end
    
    subgraph "Next.js Application"
        Page[/hr Route]
        ServerActions[Server Actions]
        ScheduleProxy[/api/schedule-proxy]
        MeetingProxy[/api/meeting-attendance-proxy]
        SupaServer[Supabase Client<br/>Service Role Key]
        ExpectedShiftBuilder[Expected Shift Builder]
    end
    
    subgraph "External Services"
        ScheduleAPI[Scheduling API<br/>Periods 1-3, 5-7]
        MeetingAPI[Meeting Attendance API<br/>Bi-weekly meetings]
    end
    
    subgraph "Supabase"
        DB[(PostgreSQL<br/>RLS: allow-all v1)]
    end
    
    UI --> State
    State --> SupaClient
    SupaClient -->|Read Queries| DB
    
    UI -->|Write Actions| ServerActions
    UI -->|External Data| ScheduleProxy
    UI -->|External Data| MeetingProxy
    
    ServerActions --> SupaServer
    SupaServer -->|Write Operations| DB
    
    ScheduleProxy --> ScheduleAPI
    ScheduleProxy -->|Cache Results| DB
    ScheduleProxy --> ExpectedShiftBuilder
    
    MeetingProxy --> MeetingAPI
    
    ExpectedShiftBuilder -->|Create/Update| DB
```

### Data Flow Patterns

**Read Pattern (Client-Side)**:
```
User Action → React Component → Supabase Client (Anon Key) → PostgreSQL (RLS allow-all) → Data Display
```

**Note (Existing Tables)**: The existing `students` and `attendance` tables retain their current RLS configuration. v1 assumes client-side reads are permitted; if reads are blocked by existing policies, reads for those tables will be proxied server-side via Next.js route handlers.

**Write Pattern (Server-Side)**:
```
User Action → React Component → Server Action → Supabase Client (Service Role) → PostgreSQL → Audit Log → Success Response
```

**Schedule Flow**:
```
User Request → Schedule Proxy → Check DB Cache (24h) → [Cache Miss] → Scheduling API → Validate + Store in DB → [If needed] Expected Shift Builder → Create shift_attendance(expected) → Return to Client
```

**Meeting Attendance Flow**:
```
User Request → Meeting Attendance Proxy → Meeting Attendance API → Apply meeting overrides with precedence (present_override > excused > API) → Return to Client
```

**Shift Exchange Flow**:
```
Submit Request (date+period+slot) → Server Action → Create shift_change_requests(pending) → Approval → Update shift_attendance expected worker for that slot → Audit Log
```

### Route Structure

```
/hr (Single Page)
├── ?tab=schedule (default)
├── ?tab=employees
├── ?tab=settings (employee off-period configuration)
├── ?tab=strikes
├── ?tab=meeting-attendance
├── ?tab=shift-attendance
├── ?tab=requests (shift exchanges)
└── ?tab=audit
```


### Permission Architecture

**Permission Checking Flow**:
```typescript
// Centralized permission hook (v1: always returns true)
function usePermission(flag: PermissionFlag): boolean {
  // v1: return true (allow-all)
  // future: check user role + permissions from user_roles table
}

// Usage in components
if (usePermission('hr.strikes.manage')) {
  // Render strikes management UI
}
```

**Permission Flags**:
- `hr.schedule.view`: View schedules
- `hr.schedule.edit`: Approve shift exchanges
- `hr.strikes.manage`: Add/remove strikes
- `hr.attendance.view`: View attendance data
- `hr.attendance.override`: Pardon/override attendance
- `hr.requests.view`: View shift exchange requests
- `hr.audit.view`: View audit log
- `hr.settings.edit`: Edit employee settings (off-periods)

**Roles** (for future use):
- `employee`: Basic access
- `manager`: Department-level access
- `HR_lead`: Full HR access
- `exec`: Executive access across all departments

## Components and Interfaces

### Core Components

**1. HRPage Component** (`app/hr/page.tsx`)
- Main page component at /hr route
- Manages tab state client-side (React state; optional `?tab=` query param sync for deep linking)
- Lazy-loads tab content components
- Handles permission checks for tab visibility
- Defaults to the Schedule tab on first load

**2. TabNavigation Component**
- Renders tab buttons: Schedule | Employees | Settings | Strikes | Meeting Attendance | Shift Attendance | Requests | Audit
- Highlights active tab with maroon accent
- Preserves scroll position on tab switch

**3. ScheduleViewer Component**
- Displays monthly schedule from Scheduling API
- Shows calendar, shift assignments (periods 1-3, 5-7), roster, summary, statistics
- Overlays approved shift exchanges to show effective worker
- Visually indicates when a shift is during an employee's off-period (based on employee_settings)
- Does NOT flag "morning shifts" (scheduler doesn't return period 0)
- Integrates with shift_change_requests to show effective assignments per slot (date+period+shift_slot_key)

**4. EmployeeOverview Component**
- Lists all employees with metrics: strikes, meeting attendance rate, shift attendance rate, shifts, points
- For clarity, distinguish scheduled vs attended counts (e.g., morning_shifts_scheduled vs morning_shifts_attended; off_period_shifts_scheduled vs off_period_shifts_attended)
- Displays detailed employee view on selection
- Detailed view includes username, assigned periods, and off_periods configuration
- Calculates meeting attendance rate from Meeting Attendance API + overrides (scope='meeting')
- Calculates shift attendance rate from shift_attendance table
- Shows points breakdown by type

**5. EmployeeSettings Component**
- Displays employee list with current off-periods configuration
- Allows editing off-periods (checkboxes for periods 1-8)
- Default off-periods: [4, 8]
- Saves to employee_settings table
- Creates audit log entry on changes

**6. StrikesManagement Component**
- Lists employees with strike counts
- Add strike form (employee selector, reason input)
- Remove strike action (marks inactive)
- Displays strike history with reason, date, issuer

**7. MeetingAttendanceDashboard Component**
- Displays meeting attendance analytics from Meeting Attendance API
- Per-student breakdown with present/absent counts
- Pardon absence action (creates attendance_overrides with scope='meeting', type='excused')
- Override attendance action (creates attendance_overrides with scope='meeting', type='present_override')
- Shows raw vs adjusted meeting attendance rates

**8. ShiftAttendanceDashboard Component**
- Displays shift attendance from shift_attendance table
- Per-employee breakdown showing expected vs actual attendance
- Mark present/absent actions (updates shift_attendance status)
- Excuse absence action (updates shift_attendance status to 'excused')
- Shows raw vs adjusted shift attendance rates
- Filters by date range, employee, shift period, and (when needed) shift_slot_key

**9. ShiftExchangeRequests Component**
- Lists pending/approved/denied shift exchange requests
- Shows from_employee → to_employee with shift details (date, period, slot/group/role/type)
- Filter by status
- Sort by requested_at timestamp (descending)
- Approve action: updates status, updates shift_attendance expected worker, records reviewer
- Deny action: updates status, records reviewer
- Displays employee names, shift details, reason, timestamp
- Pagination: 50 entries per page

**10. AuditLog Component**
- Displays all audit log entries
- Filters by date range (max 1 year), user, action type, table
- Shows user name (or 'open_access'), action, timestamp, affected record
- Displays old/new values for data changes
- Pagination: 50 entries per page with cursor (timestamp, id)

### Shared Utilities

**Standard Result Type** (`lib/types.ts`)
```typescript
type Result<T> =
  | { ok: true; data: T; correlationId: string }
  | { 
      ok: false; 
      error: { 
        code: string; 
        message: string; 
        fieldErrors?: Record<string, string> 
      }; 
      correlationId: string 
    };

function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

**Permission Utilities** (`lib/permissions.ts`)
```typescript
type PermissionFlag = 
  | 'hr.schedule.view'
  | 'hr.schedule.edit'
  | 'hr.strikes.manage'
  | 'hr.attendance.view'
  | 'hr.attendance.override'
  | 'hr.requests.view'
  | 'hr.audit.view'
  | 'hr.settings.edit';

type Role = 'employee' | 'manager' | 'HR_lead' | 'exec';

interface UserContext {
  id: string | null;
  role: Role | null;
  permissions: PermissionFlag[];
}

// v1: returns allow-all context
function getCurrentUser(): UserContext {
  return {
    id: null,
    role: null,
    permissions: [] // empty means allow-all in v1
  };
}

// v1: always returns true
function hasPermission(flag: PermissionFlag): boolean {
  return true; // allow-all in v1
}

// Future: check user_roles table
async function checkPermission(userId: string, flag: PermissionFlag): Promise<boolean> {
  // Future implementation
}
```

**API Client Utilities** (`lib/api-client.ts`)
```typescript
interface ScheduleParams {
  year: number;
  month: number;
  anchorDate: string; // YYYY-MM-DD
  anchorDay: 'A' | 'B';
  seed: number;
}

// Raw API response (with spaces in keys)
interface ScheduleAPIResponse {
  meta: { 
    year: number;
    month: number;
    anchorDate: string;
    anchorDay: string;
    seed: number;
    generatedAt: string;
    regularsPerShift: number;
    alternatesPerShift: number;
  };
  roster: Array<{ 
    id: number;
    name: string;
    s_number: string;
    scheduleable: boolean;
    Schedule: number;
  }>;
  calendar: Record<string, 'A' | 'B'>;
  schedule: Array<{ 
    Date: string;
    Day: string;
    Period: number; // 1-3, 5-7 only
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
  statistics: Array<{ Metric: string; Value: number }>;
  balanceAnalysis: Array<{ Category: string; Metric: string; Value: number }>;
}

// Normalized internal DTO
interface NormalizedScheduleResponse {
  meta: ScheduleMeta;
  roster: RosterEntry[];
  calendar: Record<string, 'A' | 'B'>;
  schedule: ScheduleAssignment[];
  summary: ScheduleSummary[];
  statistics: ScheduleStatistic[];
  balanceAnalysis: BalanceAnalysis[];
}

interface ScheduleAssignment {
  date: string;
  day: string;
  period: number; // 1-3, 5-7 from API
  // Identifies a specific assignment slot within (date, period).
  // Must be unique per slot even when (group, role, type) repeats multiple times in the same period.
  shiftSlotKey: string;
  studentName: string;
  studentSNumber: string; // Resolved from roster
  type: string;
  group: string;
  role: string;
  effectiveWorkerSNumber: string; // After applying shift exchanges
}

interface ScheduleSummary {
  student: string;
  studentSNumber: string; // Resolved from roster
  role: string;
  group: string;
  regularShifts: number;
  alternateShifts: number;
  totalShifts: number;
  periodsWorked: string;
}

// Calls /api/schedule-proxy (server-side handler)
async function fetchSchedule(params: ScheduleParams): Promise<NormalizedScheduleResponse>;

interface MeetingAttendanceParams {
  date?: string; // YYYY-MM-DD
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  exclude?: string; // comma-separated
}

interface MeetingAttendanceResponse {
  ok: boolean;
  dates: string[];
  meta: { timezone: string; generated_at: string; filters: any };
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
    }>;
  };
  sessions: Array<{ 
    date: string;
    present_count: number;
    absent_count: number;
    total_students: number;
    attendance_rate: number;
  }>;
  // Derived per-student, per-session statuses (used to apply overrides without double-counting).
  // The proxy should include this even if the upstream API provides only aggregates.
  records?: Array<{ s_number: string; date: string; status: 'present' | 'absent' }>;
  roster: Array<{ name: string; s_number: string }>;
}

// Calls /api/meeting-attendance-proxy (server-side handler)
async function fetchMeetingAttendance(params: MeetingAttendanceParams): Promise<MeetingAttendanceResponse>;
```

**Validation Schemas** (`lib/validation.ts`)
```typescript
import { z } from 'zod';

const StrikeSchema = z.object({
  employee_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

const AttendanceOverrideSchema = z.object({
  s_number: z.string(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(['meeting', 'shift']),
  shift_period: z.number().int().min(0).max(8).nullable(),
  override_type: z.enum(['excused', 'present_override']),
  reason: z.string().min(1).max(500),
}).superRefine((value, ctx) => {
  if (value.scope === 'meeting' && value.shift_period !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "shift_period must be null when scope='meeting'",
      path: ['shift_period'],
    });
  }
  if (value.scope === 'shift' && value.shift_period === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "shift_period is required when scope='shift'",
      path: ['shift_period'],
    });
  }
});

const ShiftExchangeRequestSchema = z.object({
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_period: z.number().int().min(0).max(8),
  shift_slot_key: z.string().min(1).max(200),
  from_employee_s_number: z.string(),
  to_employee_s_number: z.string(),
  reason: z.string().min(1).max(500),
});

const PointsEntrySchema = z.object({
  employee_id: z.string().uuid(),
  point_type: z.enum(['meeting', 'morning_shift', 'off_period_shift', 'project', 'manual']),
  points: z.number().int(),
  description: z.string().max(500),
});

const EmployeeSettingsSchema = z.object({
  employee_id: z.string().uuid(),
  employee_s_number: z.string(),
  off_periods: z.array(z.number().int().min(1).max(8)),
});

const ShiftAttendanceSchema = z.object({
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_period: z.number().int().min(0).max(8),
  shift_slot_key: z.string().min(1).max(200),
  employee_s_number: z.string(),
  status: z.enum(['expected', 'present', 'absent', 'excused']),
  source: z.enum(['scheduler', 'manual', 'shift_exchange', 'rebuild']),
  reason: z.string().max(500).nullable(),
});
```

**Database Client** (`lib/supabase.ts`)
```typescript
import { createClient } from '@supabase/supabase-js';

// Client-side: uses anon key, enforces RLS (allow-all in v1)
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server-side: uses service role key, bypasses RLS
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
```


### API Route Handlers

**Schedule Proxy** (`app/api/schedule-proxy/route.ts`)
- Accepts schedule parameters from client
- Checks database cache (schedules table) for existing schedule within 24 hours
- If cache miss, calls Scheduling API
- Validates Scheduling API response schema before normalization and persistence
- Normalizes API response (converts spaced keys to camelCase)
- Stores normalized response in schedules table as jsonb
- Triggers Expected Shift Builder only when the month has no shift_attendance records (or when a manual rebuild is requested)
- Returns schedule data to client
- Implements retry logic (3 attempts, exponential backoff)
- Cache: 1 hour in-memory (React Query), 24 hours in database

**Meeting Attendance Proxy** (`app/api/meeting-attendance-proxy/route.ts`)
- Accepts meeting attendance parameters from client
- Calls Meeting Attendance API with date range
- Validates response schema
- Applies meeting overrides (scope='meeting') with per-session precedence to prevent double-counting
- Returns meeting attendance data to client (no database caching)
- Implements retry logic (3 attempts, exponential backoff)
- Cache: 5 minutes in-memory (React Query) only

### Server Actions

**Strikes Actions** (`app/actions/strikes.ts`)
```typescript
'use server';

async function addStrike(employeeId: string, reason: string): Promise<Result<Strike>>;
async function removeStrike(strikeId: string): Promise<Result<Strike>>;
async function getActiveStrikes(employeeId: string): Promise<Result<Strike[]>>;
```

**Attendance Override Actions** (`app/actions/attendance.ts`)
```typescript
'use server';

async function pardonMeetingAbsence(sNumber: string, date: string, reason: string): Promise<Result<AttendanceOverride>>;
async function overrideMeetingAttendance(sNumber: string, date: string, reason: string): Promise<Result<AttendanceOverride>>;
async function getAttendanceOverrides(sNumber: string, scope: 'meeting' | 'shift'): Promise<Result<AttendanceOverride[]>>;

// Note: scope='shift' is reserved for future shift attendance overrides (not implemented in v1).
// In v1, shift excusals are handled directly via shift_attendance.status='excused'.
// For meeting overrides, server actions must use UPSERT on the meeting-scope unique index and update override_type/reason on conflict (never create contradictory records).
```

**Points Actions** (`app/actions/points.ts`)
```typescript
'use server';

async function awardPoints(employeeId: string, pointType: PointType, points: number, description: string): Promise<Result<PointsEntry>>;
async function getPointsBreakdown(employeeId: string): Promise<Result<PointsBreakdown>>;
```

**Shift Exchange Request Actions** (`app/actions/shift-requests.ts`)
```typescript
'use server';

// shiftSlotKey identifies the specific schedule slot being exchanged.
// It must be unique per slot within (shiftDate, shiftPeriod), not just a label (see normalization logic).
async function submitShiftExchange(shiftDate: string, shiftPeriod: number, shiftSlotKey: string, fromSNumber: string, toSNumber: string, reason: string): Promise<Result<ShiftChangeRequest>>;
async function approveShiftExchange(requestId: string): Promise<Result<ShiftChangeRequest>>;
async function denyShiftExchange(requestId: string): Promise<Result<ShiftChangeRequest>>;
async function getShiftExchangeRequests(status?: RequestStatus, limit?: number, cursor?: string): Promise<Result<{ requests: ShiftChangeRequest[]; nextCursor: string | null }>>;

// Note: submitShiftExchange implementation:
// 1. Validate fromSNumber <> toSNumber (fail 400 with fieldErrors.to_employee_s_number if equal)
// 2. Verify the referenced slot exists: there must be a schedule assignment for (shiftDate, shiftPeriod, shiftSlotKey)
//    - Source of truth: normalized schedule (from schedules cache / Scheduling API) + shiftSlotKey derivation
// 3. Verify the requester is exchanging the correct assignment:
//    - Determine the current expected worker for that slot (apply approved exchanges)
//    - Require expectedWorkerSNumber === fromSNumber (v1 behavior)
// 4. If the slot does not exist, return 400 with fieldErrors.shift_slot_key = "No such shift slot for that date/period"
// 5. Create shift_change_requests row with status='pending'
//    - Enforced by DB: one pending per (shiftDate, shiftPeriod, shiftSlotKey, fromSNumber)
//    - Enforced by DB: from_employee_s_number <> to_employee_s_number

// Note: approveShiftExchange implementation:
// 1. Load the request (must be status='pending' to approve)
// 2. Reject if from_employee shift_attendance record has status in ('present','absent','excused')
// 3. Reject if to_employee already has a NON-EXPECTED shift_attendance record for the same (shift_date, shift_period, shift_slot_key)
//    (status in 'present'|'absent'|'excused' means this slot is already finalized for that employee; return a clear error)
// 4. Reject if another approved shift_change_requests row already exists for the same (shift_date, shift_period, shift_slot_key, from_employee_s_number)
//    (enforces one approved exchange per original assignment)
// 5. Delete the from_employee shift_attendance record for the same (shift_date, shift_period, shift_slot_key) (if exists)
// 6. Insert the to_employee shift_attendance record for the same slot with status='expected' and source='shift_exchange'
//    (use INSERT ... ON CONFLICT DO NOTHING for idempotence; do not overwrite present/absent/excused rows)
// 7. Update shift_change_requests status to 'approved', set reviewed_by and reviewed_at
// 8. Create audit_log entry
```

**Shift Attendance Actions** (`app/actions/shift-attendance.ts`)
```typescript
'use server';

async function markShiftPresent(sNumber: string, date: string, period: number, shiftSlotKey: string): Promise<Result<ShiftAttendance>>;
async function markShiftAbsent(sNumber: string, date: string, period: number, shiftSlotKey: string): Promise<Result<ShiftAttendance>>;
async function excuseShiftAbsence(sNumber: string, date: string, period: number, shiftSlotKey: string, reason: string): Promise<Result<ShiftAttendance>>;
async function getShiftAttendance(filters: ShiftAttendanceFilters): Promise<Result<ShiftAttendance[]>>;

// Note: excuseShiftAbsence updates shift_attendance.status to 'excused'
```

**Employee Settings Actions** (`app/actions/employee-settings.ts`)
```typescript
'use server';

async function updateEmployeeOffPeriods(employeeId: string, offPeriods: number[]): Promise<Result<EmployeeSettings>>;
async function getEmployeeSettings(employeeId: string): Promise<Result<EmployeeSettings>>;
async function getAllEmployeeSettings(): Promise<Result<EmployeeSettings[]>>;
```

**Expected Shift Builder** (`app/actions/expected-shifts.ts`)
```typescript
'use server';

// Builds expected shift attendance records from schedule + approved exchanges
// Triggered: automatically on first schedule fetch for a month (when no shift_attendance rows exist), or manually via "Build Expected Shifts" (forceRebuild=true)
async function buildExpectedShifts(
  year: number,
  month: number,
  options?: { forceRebuild?: boolean }
): Promise<Result<{ created: number; updated: number }>>;

// Internal logic:
// 1. Compute the calendar-month window in America/Chicago timezone
// 2. If options.forceRebuild=true: delete existing shift_attendance rows in the window where status='expected' (preserve present/absent/excused)
// 3. Fetch schedule from Scheduling API (or cache) and fetch all approved shift exchanges for the month
// 4. For each schedule assignment, resolve the expected worker after applying approved exchanges
// 5. Upsert shift_attendance rows for expected workers:
//    - Insert status='expected' and source ('scheduler' | 'shift_exchange')
//    - ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number) DO NOTHING when an existing row is present/absent/excused
// 6. Ensure idempotence: multiple runs produce no duplicates and do not overwrite non-expected statuses
```

**Audit Log Actions** (`app/actions/audit.ts`)
```typescript
'use server';

interface AuditFilters {
  dateFrom?: string;
  dateTo?: string; // max 1 year from dateFrom
  userId?: string;
  actionType?: string;
  tableName?: string;
  limit?: number; // default: 50
  cursor?: string; // timestamp + id for pagination
}

async function createAuditEntry(action: string, tableName: string, recordId: string, oldValue: any, newValue: any): Promise<void>;
async function getAuditLog(filters: AuditFilters): Promise<Result<{ entries: AuditEntry[]; nextCursor: string | null }>>;
```

## Data Models

### Database Schema

**New Tables** (to be created):

```sql
-- Strikes table
CREATE TABLE strikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES students(id),
  reason TEXT NOT NULL,
  issued_by TEXT, -- nullable in v1
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_strikes_employee_active ON strikes(employee_id, active);

-- Shift exchange requests table
CREATE TABLE shift_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''), -- unique per slot within (shift_date, shift_period); e.g., Group|Role|Type|slotIndex
  from_employee_s_number TEXT NOT NULL,
  to_employee_s_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT, -- nullable in v1
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX idx_shift_change_status_date ON shift_change_requests(status, requested_at DESC);

ALTER TABLE shift_change_requests
  ADD CONSTRAINT shift_change_requests_from_to_distinct
  CHECK (from_employee_s_number <> to_employee_s_number);

-- Enforce one approved exchange per original assignment (prevents ambiguous "expected worker" resolution)
CREATE UNIQUE INDEX idx_shift_change_one_approved_per_assignment
  ON shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status='approved';

-- Prevent spam: only one pending request per (slot, from_employee)
CREATE UNIQUE INDEX idx_shift_change_one_pending_per_assignment
  ON shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status='pending';

-- Points ledger table
CREATE TABLE points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES students(id),
  point_type TEXT NOT NULL CHECK (point_type IN ('meeting', 'morning_shift', 'off_period_shift', 'project', 'manual')),
  points INTEGER NOT NULL,
  description TEXT,
  awarded_by TEXT, -- nullable in v1
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_points_employee ON points_ledger(employee_id);

-- Audit log table (retained indefinitely; no TTL/purge in v1)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT, -- nullable in v1, 'open_access' or null
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_table_timestamp ON audit_log(table_name, timestamp DESC);

-- User roles table (for future auth)
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'HR_lead', 'exec')),
  department TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Attendance overrides table (meeting attendance only in v1)
CREATE TABLE attendance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s_number TEXT NOT NULL,
  checkin_date DATE NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('meeting', 'shift')),
  shift_period INTEGER CHECK (shift_period BETWEEN 0 AND 8), -- nullable, required when scope='shift'
  override_type TEXT NOT NULL CHECK (override_type IN ('excused', 'present_override')),
  reason TEXT NOT NULL,
  overridden_by TEXT, -- nullable in v1
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attendance_overrides
  ADD CONSTRAINT attendance_overrides_scope_period_consistency
  CHECK (
    (scope = 'meeting' AND shift_period IS NULL)
    OR
    (scope = 'shift' AND shift_period IS NOT NULL)
  );

CREATE INDEX idx_attendance_overrides_lookup ON attendance_overrides(s_number, checkin_date);
CREATE INDEX idx_attendance_overrides_date ON attendance_overrides(checkin_date);

-- Partial unique indexes for meeting and shift scopes
-- If this migration is being applied to an existing DB that may contain duplicates, dedupe before creating these:
-- (keeps the most recent row by (overridden_at, id))
-- DELETE FROM attendance_overrides a
-- USING attendance_overrides b
-- WHERE a.scope='meeting'
--   AND b.scope='meeting'
--   AND a.s_number=b.s_number
--   AND a.checkin_date=b.checkin_date
--   AND (a.overridden_at, a.id) < (b.overridden_at, b.id);

CREATE UNIQUE INDEX idx_attendance_overrides_meeting_unique 
  ON attendance_overrides(s_number, checkin_date, scope) 
  WHERE scope='meeting';

CREATE UNIQUE INDEX idx_attendance_overrides_shift_unique 
  ON attendance_overrides(s_number, checkin_date, scope, shift_period) 
  WHERE scope='shift';

-- Note: In v1, scope='meeting' is used for meeting attendance overrides
-- scope='shift' is reserved for future shift attendance overrides and is intentionally unused in v1 (do not insert records with scope='shift' in v1)
-- Shift excusals in v1 update shift_attendance.status to 'excused' directly

-- Schedules cache table
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  anchor_date DATE NOT NULL,
  anchor_day TEXT NOT NULL CHECK (anchor_day IN ('A', 'B')),
  seed INTEGER NOT NULL,
  schedule_data JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year, month, anchor_date, anchor_day, seed)
);

CREATE INDEX idx_schedules_lookup ON schedules(year, month, anchor_date, anchor_day, seed);

-- Employee settings table
CREATE TABLE employee_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES students(id),
  employee_s_number TEXT NOT NULL,
  off_periods INTEGER[] NOT NULL DEFAULT '{4,8}'::INTEGER[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id),
  UNIQUE(employee_s_number)
);

CREATE INDEX idx_employee_settings_snumber ON employee_settings(employee_s_number);

-- Shift attendance table
CREATE TABLE shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''), -- unique per slot within (shift_date, shift_period); e.g., Group|Role|Type|slotIndex
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT, -- nullable v1
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

CREATE INDEX idx_shift_attendance_lookup ON shift_attendance(employee_s_number, shift_date);
CREATE INDEX idx_shift_attendance_date_period ON shift_attendance(shift_date, shift_period);
CREATE INDEX idx_shift_attendance_slot ON shift_attendance(shift_date, shift_period, shift_slot_key);

-- Note: Excused absences for shifts are handled by updating shift_attendance.status to 'excused'
-- Status values: expected (assigned), present (attended), absent (missed), excused (absence pardoned)
```


**RLS Policies** (v1: allow-all for both anon and authenticated roles):

```sql
-- Enable RLS on all tables
ALTER TABLE strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_attendance ENABLE ROW LEVEL SECURITY;

-- Create allow-all policies for v1
CREATE POLICY "open_access_strikes" ON strikes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_shift_change_requests" ON shift_change_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_points_ledger" ON points_ledger FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_audit_log" ON audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_user_roles" ON user_roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_attendance_overrides" ON attendance_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_schedules" ON schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_employee_settings" ON employee_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_access_shift_attendance" ON shift_attendance FOR ALL USING (true) WITH CHECK (true);

-- Future: replace (true) with role-based conditions like:
-- USING (auth.uid() = user_id OR has_permission(auth.uid(), 'hr.strikes.manage'))
```

**Update Triggers**:

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_strikes_updated_at BEFORE UPDATE ON strikes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_settings_updated_at BEFORE UPDATE ON employee_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### TypeScript Interfaces

```typescript
// Domain Models
interface Employee {
  id: string;
  name: string;
  s_number: string;
  strikes_count: number;
  meeting_attendance_rate: number;
  shift_attendance_rate: number;
  total_shifts: number;
  // Attended counts (status='present')
  morning_shifts_attended: number;
  off_period_shifts_attended: number;
  // Scheduled counts (any status)
  morning_shifts_scheduled: number;
  off_period_shifts_scheduled: number;
  total_points: number;
}

interface Strike {
  id: string;
  employee_id: string;
  employee_name: string;
  reason: string;
  issued_by: string | null;
  issued_at: string;
  active: boolean;
}

interface AttendanceOverride {
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

interface ShiftChangeRequest {
  id: string;
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  from_employee_s_number: string;
  from_employee_name: string;
  to_employee_s_number: string;
  to_employee_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface PointsEntry {
  id: string;
  employee_id: string;
  point_type: 'meeting' | 'morning_shift' | 'off_period_shift' | 'project' | 'manual';
  points: number;
  description: string;
  awarded_by: string | null;
  awarded_at: string;
}

interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string;
  old_value: any;
  new_value: any;
  timestamp: string;
}

interface EmployeeSettings {
  id: string;
  employee_id: string;
  employee_s_number: string;
  off_periods: number[];
  created_at: string;
  updated_at: string;
}

interface ShiftAttendance {
  id: string;
  shift_date: string;
  shift_period: number;
  shift_slot_key: string;
  employee_s_number: string;
  status: 'expected' | 'present' | 'absent' | 'excused';
  source: 'scheduler' | 'manual' | 'shift_exchange' | 'rebuild';
  reason: string | null;
  marked_by: string | null;
  marked_at: string;
}

// Computed Models
interface EmployeeMetrics {
  employee: Employee;
  strikes: Strike[];
  points_breakdown: Record<PointType, number>;
  meeting_attendance_details: {
    raw_rate: number;
    adjusted_rate: number;
    total_sessions: number;
    attended: number;
    excused: number;
  };
  shift_attendance_details: {
    raw_rate: number;
    adjusted_rate: number;
    expected_shifts: number;
    attended: number;
    excused: number;
  };
}

interface MeetingAttendanceAnalytics {
  total_students: number;
  total_sessions: number;
  avg_attendance: number;
  students: Array<{
    name: string;
    s_number: string;
    present_count: number;
    absent_count: number;
    raw_attendance_rate: number;
    adjusted_attendance_rate: number;
    overrides: AttendanceOverride[];
  }>;
}

interface ShiftAttendanceAnalytics {
  date_range: { from: string; to: string };
  employees: Array<{
    s_number: string;
    name: string;
    expected_shifts: number;
    present: number;
    absent: number;
    excused: number;
    raw_rate: number;
    adjusted_rate: number;
  }>;
}
```

### Meeting Attendance Rate Calculation Logic

```typescript
interface MeetingAttendanceRateInputs {
  // Per-session, per-student attendance status derived from Meeting Attendance API response
  // (the proxy must preserve session dates so overrides can be applied without double-counting).
  attendanceRecords: Array<{ date: string; status: 'present' | 'absent' }>;
  overrides: AttendanceOverride[]; // from database where scope='meeting'
}

function calculateMeetingAttendanceRate(inputs: MeetingAttendanceRateInputs): {
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

  // Build override lookup.
  // In normal operation, meeting overrides are upserted on a unique key so there should be at most one row per date.
  // If legacy/invalid data contains duplicates, resolve deterministically to avoid hard failures (prefer present_override).
  const overrideByDate = new Map<string, AttendanceOverride['override_type']>();
  for (const o of inputs.overrides) {
    if (o.scope !== 'meeting') continue;
    const existing = overrideByDate.get(o.checkin_date);
    if (!existing) {
      overrideByDate.set(o.checkin_date, o.override_type);
      continue;
    }
    if (existing === o.override_type) continue;
    // Conflict resolution: prefer present_override over excused (last-write-wins also acceptable if timestamps are available).
    overrideByDate.set(
      o.checkin_date,
      existing === 'present_override' || o.override_type === 'present_override'
        ? 'present_override'
        : 'excused'
    );
  }

  // Precedence per session:
  // 1) present_override → present
  // 2) excused → excluded from adjusted denominator
  // 3) otherwise use API status
  let attended = 0;
  let excused = 0;
  for (const session of inputs.attendanceRecords) {
    const override = overrideByDate.get(session.date);
    if (override === 'present_override') {
      attended += 1;
      continue;
    }
    if (override === 'excused') {
      excused += 1;
      continue;
    }
    if (session.status === 'present') attended += 1;
  }

  const raw_rate = (attended / total_sessions) * 100;
  const adjusted_denominator = total_sessions - excused;
  const adjusted_rate =
    adjusted_denominator <= 0 ? null : (attended / adjusted_denominator) * 100;

  return { raw_rate, adjusted_rate, total_sessions, attended, excused };
}
```

### Shift Attendance Rate Calculation Logic

```typescript
interface ShiftAttendanceRateInputs {
  shiftAttendanceRecords: ShiftAttendance[]; // from shift_attendance table
}

function calculateShiftAttendanceRate(inputs: ShiftAttendanceRateInputs): {
  raw_rate: number | null;
  adjusted_rate: number | null;
  expected_shifts: number;
  attended: number;
  excused: number;
} {
  // Count expected shifts (all records)
  const expected_shifts = inputs.shiftAttendanceRecords.length;
  
  if (expected_shifts === 0) {
    return { raw_rate: null, adjusted_rate: null, expected_shifts: 0, attended: 0, excused: 0 };
  }
  
  // Count attended (status='present')
  const attended = inputs.shiftAttendanceRecords.filter(r => r.status === 'present').length;
  
  // Count excused (status='excused')
  const excused = inputs.shiftAttendanceRecords.filter(r => r.status === 'excused').length;
  
  // Calculate rates
  const raw_rate = (attended / expected_shifts) * 100;
  const adjusted_denominator = expected_shifts - excused;
  const adjusted_rate =
    adjusted_denominator <= 0 ? null : (attended / adjusted_denominator) * 100;
  
  return { raw_rate, adjusted_rate, expected_shifts, attended, excused };
}
```

### Schedule Normalization and Exchange Application

```typescript
// Normalize API response to internal format
function normalizeScheduleResponse(raw: ScheduleAPIResponse): NormalizedScheduleResponse {
  // Build s_number lookup from roster
  const nameToSNumber = new Map<string, string>();
  raw.roster.forEach(r => nameToSNumber.set(r.name, r.s_number));
  
  // Normalize schedule assignments
  // IMPORTANT: shiftSlotKey must uniquely identify a slot within a (date, period).
  // Prefer an upstream unique assignment id if the API provides one. If not available, derive:
  //   labelKey = Group|Role|Type
  //   slotIndex = ordinal within (date, period, labelKey) using a deterministic sort
  //   shiftSlotKey = labelKey|slotIndex
  //
  // This prevents ambiguity if the scheduler emits multiple rows with the same Group/Role/Type in the same period.
  const scheduleRows = raw.schedule.map(a => {
    const studentSNumber = nameToSNumber.get(a.Student);
    if (!studentSNumber) {
      throw new Error(`Schedule normalization failed: missing s_number for "${a.Student}"`);
    }
    const labelKey = `${a.Group}|${a.Role}|${a.Type}`;
    return {
      date: a.Date,
      day: a.Day,
      period: a.Period,
      labelKey,
      studentName: a.Student,
      studentSNumber,
      type: a.Type,
      group: a.Group,
      role: a.Role,
    };
  });

  scheduleRows.sort((left, right) => {
    // ISO dates sort lexicographically; include studentSNumber to ensure deterministic ordering.
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.period !== right.period) return left.period - right.period;
    if (left.labelKey !== right.labelKey) return left.labelKey.localeCompare(right.labelKey);
    const bySNumber = left.studentSNumber.localeCompare(right.studentSNumber);
    if (bySNumber !== 0) return bySNumber;
    return left.studentName.localeCompare(right.studentName);
  });

  const slotCounters = new Map<string, number>(); // (date|period|labelKey) -> next index
  const schedule = scheduleRows.map(row => {
    const counterKey = `${row.date}|${row.period}|${row.labelKey}`;
    const slotIndex = slotCounters.get(counterKey) ?? 0;
    slotCounters.set(counterKey, slotIndex + 1);

    const shiftSlotKey = `${row.labelKey}|${slotIndex}`;

    return {
      date: row.date,
      day: row.day,
      period: row.period, // 1-3, 5-7 from API
      shiftSlotKey,
      studentName: row.studentName,
      studentSNumber: row.studentSNumber,
      type: row.type,
      group: row.group,
      role: row.role,
      effectiveWorkerSNumber: row.studentSNumber, // Will be updated by exchanges
    };
  });
  
  // Normalize summary
  const summary = raw.summary.map(s => {
    const studentSNumber = nameToSNumber.get(s.Student);
    if (!studentSNumber) {
      throw new Error(`Schedule normalization failed: missing s_number for summary "${s.Student}"`);
    }
    return {
      student: s.Student,
      studentSNumber,
      role: s.Role,
      group: s.Group,
      regularShifts: s['Regular Shifts'],
      alternateShifts: s['Alternate Shifts'],
      totalShifts: s['Total Shifts'],
      periodsWorked: s['Periods Worked'],
    };
  });
  
  return {
    meta: raw.meta,
    roster: raw.roster,
    calendar: raw.calendar,
    schedule,
    summary,
    statistics: raw.statistics,
    balanceAnalysis: raw.balanceAnalysis,
  };
}

// Apply approved shift exchanges to schedule
function applyShiftExchanges(
  schedule: NormalizedScheduleResponse,
  exchanges: ShiftChangeRequest[]
): NormalizedScheduleResponse {
  // Build exchange map: (date, period, shift_slot_key, from_s_number) → to_s_number
  const exchangeMap = new Map<string, string>();
  exchanges
    .filter(e => e.status === 'approved')
    .forEach(e => {
      const key = `${e.shift_date}-${e.shift_period}-${e.shift_slot_key}-${e.from_employee_s_number}`;
      exchangeMap.set(key, e.to_employee_s_number);
    });
  
  // Apply exchanges to schedule assignments
  const updatedSchedule = schedule.schedule.map(assignment => {
    const key = `${assignment.date}-${assignment.period}-${assignment.shiftSlotKey}-${assignment.studentSNumber}`;
    const newWorker = exchangeMap.get(key);
    
    if (newWorker) {
      return {
        ...assignment,
        effectiveWorkerSNumber: newWorker,
        exchanged: true,
      };
    }
    
    return assignment;
  });
  
  return {
    ...schedule,
    schedule: updatedSchedule,
  };
}
```

### Off-Period Classification Logic

```typescript
function isOffPeriodShift(shiftPeriod: number, employeeOffPeriods: number[]): boolean {
  return employeeOffPeriods.includes(shiftPeriod);
}

// Usage in schedule display
function getShiftMetadata(assignment: ScheduleAssignment, employeeSettings: EmployeeSettings) {
  return {
    ...assignment,
    isOffPeriodForWorker: isOffPeriodShift(assignment.period, employeeSettings.off_periods),
    isMorningShift: assignment.period === 0,
  };
}
```

## Correctness Properties


A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Schedule API Parameter Passing

*For any* valid schedule parameters (year, month, anchorDate, anchorDay, seed), when requesting a schedule, the Scheduling API should be called with exactly those parameters.

**Validates: Requirements 1.1**

### Property 2: Schedule Display Completeness

*For any* schedule response from the Scheduling API, the displayed schedule should include all required sections: calendar view, shift assignments, roster, summary, and statistics.

**Validates: Requirements 1.2**

### Property 3: Shift Exchange Overlay

*For any* schedule with approved shift exchanges, the displayed schedule should show the effective worker (to_employee) for exchanged shifts, not the original assigned worker (from_employee), by matching on (shift_date, shift_period, shift_slot_key, from_employee_s_number).

**Validates: Requirements 1.3**

### Property 4: Off-Period Visual Indication

*For any* shift assignment and employee, if the shift period is in the employee's off_periods list, the shift should be visually indicated as an off-period shift for that employee.

**Validates: Requirements 1.4**

### Property 5: Schedule Caching Prevents Redundant API Calls

*For any* schedule parameters, when the same parameters are requested twice within the same session, only one API call should be made to the Scheduling API.

**Validates: Requirements 1.6**

### Property 6: Employee Overview Display Completeness

*For any* employee record, the employee overview display should include name, strikes count, meeting attendance rate, shift attendance rate, total shifts, morning shifts, off-period shifts, and points.

**Validates: Requirements 2.1**

### Property 7: Total Scheduled Shifts Calculation

*For any* employee and date range, the total scheduled shifts should equal the count of all shift_attendance records for that employee in the date range, regardless of status.

**Validates: Requirements 2.2**

### Property 8: Morning Shifts Calculation

*For any* employee, the morning shifts attended count should equal the count of shift_attendance records with shift_period=0 and status='present'. (Optional metric: morning shifts scheduled counts all statuses for shift_period=0.)

**Validates: Requirements 2.3**

### Property 9: Off-Period Shifts Calculation

*For any* employee, the off-period shifts attended count should equal the count of shift_attendance records where shift_period is in the employee's off_periods list and status='present'. (Optional metric: off-period shifts scheduled counts all statuses where shift_period is in off_periods.)

**Validates: Requirements 2.4**

### Property 10: Meeting Attendance Rate Data Sources

*For any* employee and date range, calculating meeting attendance rate should use per-session status data from the Meeting Attendance API and apply at most one override per session date from attendance_overrides where scope='meeting' using precedence: present_override → present, excused → exclude from adjusted denominator, otherwise use API status.

**Validates: Requirements 2.5**

### Property 11: Raw Meeting Attendance Rate Formula

*For any* employee with meeting attendance sessions, the raw meeting attendance rate should equal (attended_sessions / total_sessions) * 100.

**Validates: Requirements 2.6**

### Property 12: Adjusted Meeting Attendance Rate Formula

*For any* employee with meeting attendance sessions and excused absences, the adjusted meeting attendance rate should equal (attended_sessions / (total_sessions - excused_absences)) * 100, and if (total_sessions - excused_absences) is 0 the adjusted rate should be null ("N/A").

**Validates: Requirements 2.7**

### Property 13: Shift Attendance Rate Data Sources

*For any* employee and date range, calculating shift attendance rate should use shift_attendance records where excused absences have status='excused'.

**Validates: Requirements 2.8**

### Property 14: Raw Shift Attendance Rate Formula

*For any* employee with expected shifts, the raw shift attendance rate should equal (attended_shifts / scheduled_shifts) * 100 where attended_shifts have status='present' and scheduled_shifts is the count of all shift_attendance records.

**Validates: Requirements 2.9**

### Property 15: Adjusted Shift Attendance Rate Formula

*For any* employee with expected shifts and excused absences (shift_attendance records with status='excused'), the adjusted shift attendance rate should equal (attended_shifts / (scheduled_shifts - excused_shifts)) * 100, and if (scheduled_shifts - excused_shifts) is 0 the adjusted rate should be null ("N/A").

**Validates: Requirements 2.10**

### Property 16: Attendance Rate N/A Display

*For any* employee with no meeting or shift data for a date range, the respective attendance rate should display as "N/A" rather than 0 or null.

**Validates: Requirements 2.11**

### Property 17: Points Summation

*For any* employee with points entries in the points_ledger, the total points should equal the sum of all point values from all entries.

**Validates: Requirements 2.12**

### Property 18: Employee Detail Display Completeness

*For any* selected employee, the detailed view should include username, assigned periods, and off_periods configuration.

**Validates: Requirements 2.13**

### Property 19: Employee Off-Periods Configuration

*For any* employee, the employee_settings table should store their off_periods as an integer array, defaulting to [4, 8] for new employees.

**Validates: Requirements 3.1, 3.3**

### Property 20: Off-Periods Update

*For any* employee and new off_periods array, updating the employee's off-periods should update the employee_settings record and create an audit_log entry.

**Validates: Requirements 3.2**

### Property 21: Off-Period Shift Identification

*For any* employee and shift, the shift should be classified as an off-period shift if and only if the shift_period is in the employee's off_periods array.

**Validates: Requirements 3.5**

### Property 22: Off-Period Shift Points

*For any* employee completing a shift during one of their off_periods, the system should award 1 point with point_type='off_period_shift'.

**Validates: Requirements 3.6**

### Property 23: Strike Creation Records All Fields

*For any* valid strike (employee_id and reason), adding the strike should create a database record with employee_id, reason, issued_by, issued_at, and active=true.

**Validates: Requirements 4.1**

### Property 24: Strike Removal is Soft Delete

*For any* existing active strike, removing the strike should mark the record as active=false without deleting the record from the database.

**Validates: Requirements 4.2**

### Property 25: Active Strikes Filtering

*For any* employee with both active and inactive strikes, the displayed strike count should equal only the number of active strikes.

**Validates: Requirements 4.3**

### Property 26: Strike Display Completeness

*For any* active strike, the displayed strike information should include reason, date issued (issued_at), and issuing user (issued_by).

**Validates: Requirements 4.6**

### Property 27: Meeting Attendance API Parameter Passing

*For any* valid meeting attendance parameters (date, from, to, exclude), when requesting meeting attendance data, the Meeting Attendance API should be called with exactly those parameters.

**Validates: Requirements 5.1**

### Property 28: Meeting Attendance Analytics Display Completeness

*For any* meeting attendance response from the Meeting Attendance API, the displayed analytics should include total students, total sessions, average attendance, and per-student breakdown.

**Validates: Requirements 5.2**

### Property 29: Per-Student Meeting Attendance Display Completeness

*For any* student in the meeting attendance data, the displayed information should include name, s_number, present_count, absent_count, and attendance_rate.

**Validates: Requirements 5.3**

### Property 30: Meeting Pardon Creates Excused Override

*For any* student and meeting date, pardoning a meeting absence should upsert exactly one attendance_overrides record keyed by (s_number, checkin_date, scope='meeting') with override_type='excused'. If an override already exists with a different override_type, it should be updated (not duplicated) so excused and present_override cannot coexist for the same date.

**Validates: Requirements 5.4**

### Property 31: Meeting Override Creates Present Override

*For any* student and meeting date, overriding meeting attendance should upsert exactly one attendance_overrides record keyed by (s_number, checkin_date, scope='meeting') with override_type='present_override'. If an override already exists with a different override_type, it should be updated (not duplicated), and an audit_log entry should be created.

**Validates: Requirements 5.5**

### Property 32: Expected Shift Creation from Schedule

*For any* schedule generated from the Scheduling API, the system should create shift_attendance records with status='expected' for all assigned shifts, preserving assignment identity via (shift_date, shift_period, shift_slot_key, employee_s_number).

**Validates: Requirements 6.2**

### Property 33: Shift Exchange Deletes and Creates Records

*For any* approved shift exchange, the system should delete the shift_attendance record for the from_employee for the specified (shift_date, shift_period, shift_slot_key) and create a new shift_attendance record for the to_employee with status='expected' and source='shift_exchange' for the same slot.

**Validates: Requirements 6.3, 20.2**

### Property 34: Shift Attendance Status Updates

*For any* shift attendance record, marking the shift as present or absent should update the status field accordingly.

**Validates: Requirements 6.4, 6.5**

### Property 35: Shift Absence Excusal Updates Status

*For any* shift attendance record, excusing an absence should update the shift_attendance status to 'excused' and record the reason and marked_by fields.

**Validates: Requirements 6.6**

### Property 36: Shift Exchange Request Creation

*For any* valid shift exchange (shift_date, shift_period, shift_slot_key, from_s_number, to_s_number, reason), submitting the request should: (1) verify the referenced shift slot exists for that date/period, (2) verify from_s_number matches the current expected worker for that slot, and (3) create a database record with all specified fields and status='pending'. If the slot does not exist, the request should fail with a 400 and a field error on shift_slot_key.

**Validates: Requirements 7.1**

### Property 37: Shift Exchange Request Display Completeness

*For any* pending shift exchange request, the displayed information should include from/to employee names, shift date, shift period, shift_slot_key (slot details), and reason.

**Validates: Requirements 7.2**

### Property 38: Shift Exchange Approval Updates

*For any* shift exchange request where the from_employee shift_attendance record has status='expected', approving the request should: (1) reject if the to_employee already has a NON-EXPECTED shift_attendance record for the same (shift_date, shift_period, shift_slot_key) (present/absent/excused), (2) reject if another approved shift_change_requests row exists for the same (shift_date, shift_period, shift_slot_key, from_employee_s_number), (3) update the request status to 'approved', (4) delete the from_employee shift_attendance record for the same (shift_date, shift_period, shift_slot_key) if it exists, (5) create the to_employee shift_attendance record for the same slot with status='expected' and source='shift_exchange' (idempotent if it already exists as expected), and (6) record the reviewed_by and reviewed_at fields.

**Validates: Requirements 7.3**

### Property 39: Shift Exchange Approval Rejection

*For any* shift exchange request where the from_employee shift_attendance record has status in ('present','absent','excused'), attempting to approve the request should be rejected with an error.

**Validates: Requirements 7.4**

### Property 40: Shift Exchange Denial Updates

*For any* shift exchange request, denying the request should update the status to 'denied' and record the reviewed_by and reviewed_at fields.

**Validates: Requirements 7.5**

### Property 41: Shift Exchange Request Filtering

*For any* collection of shift exchange requests with different statuses, filtering by a specific status should return only requests matching that status.

**Validates: Requirements 7.7**

### Property 42: Shift Exchange Request Pagination

*For any* collection of shift exchange requests, the system should implement pagination with a default limit of 50 entries per page.

**Validates: Requirements 7.8**

### Property 43: Shift Exchange Request Sorting

*For any* collection of shift exchange requests, the displayed list should be sorted by requested_at timestamp in descending order (newest first).

**Validates: Requirements 7.9**

### Property 44: API Retry Logic on Failure

*For any* external API call that fails, the system should retry up to 3 times with exponential backoff (100ms, 200ms, 400ms) before returning an error.

**Validates: Requirements 11.4**

### Property 45: Cache Expiration Times

*For any* cached external API response, schedule data should expire after 1 hour in-memory and 24 hours in database, and meeting attendance data should expire after 5 minutes in-memory.

**Validates: Requirements 11.5**

### Property 46: API Response Schema Validation

*For any* response from external APIs, the response should be validated against the expected schema before processing, and invalid responses should be rejected. Schedule normalization must never produce blank identifiers (e.g., missing/empty `studentSNumber`); if a schedule assignment cannot be mapped to a roster `s_number`, the request must fail with a validation error rather than emitting empty strings.

**Validates: Requirements 11.6**

### Property 47: Points Awarding for Activities

*For any* employee and activity type (meeting, morning_shift with period=0, off_period_shift), completing the activity should add 1 point to the points_ledger with the correct point_type.

**Validates: Requirements 14.1, 14.2, 14.3**

### Property 48: Points Entry Field Completeness

*For any* points entry, the record should include point_type, points value, description, and awarded_by.

**Validates: Requirements 14.4**

### Property 49: Manual Points Adjustment

*For any* employee and point adjustment (positive or negative), manually adjusting points should create a points_ledger entry with point_type='manual' and the specified description.

**Validates: Requirements 14.6**

### Property 50: Points Breakdown by Type

*For any* employee with points entries, the points breakdown should group entries by point_type and sum points for each type.

**Validates: Requirements 14.7**

### Property 51: Audit Log Creation for All Modifications

*For any* data modification operation (strikes, attendance overrides, points, shift exchanges, shift attendance, employee settings), an audit_log entry should be created with action, table_name, record_id, old_value (jsonb), new_value (jsonb), and timestamp.

**Validates: Requirements 4.4, 7.6, 15.1**

### Property 52: Audit Log Field Completeness

*For any* audit log entry, the record should include user_id (null or 'open_access' in v1), action, table_name, record_id, old_value (jsonb), new_value (jsonb), and timestamp.

**Validates: Requirements 15.2, 15.3**

### Property 53: Audit Log Display Completeness

*For any* audit log entry, the displayed information should include user name (or system identifier), action description, timestamp, and affected record details.

**Validates: Requirements 15.4**

### Property 54: Audit Log Filtering with Pagination

*For any* collection of audit log entries, filtering by date range (max 1 year), user, action type, or table should return only entries matching all specified filter criteria, with a default limit of 50 entries and cursor-based pagination.

**Validates: Requirements 15.5, 15.6, 15.7**

### Property 55: Validation Error Message Specificity

*For any* invalid input that fails validation, the error message should specify which field is invalid and why it failed validation.

**Validates: Requirements 21.5**

### Property 56: HTTP Status Code Correctness

*For any* server-side error condition, the response should return the appropriate HTTP status code (400 for validation errors, 401 for authentication errors, 403 for permission errors, 500 for server errors).

**Validates: Requirements 17.6**

### Property 57: Schedule Database Caching

*For any* schedule fetched from the Scheduling API, the complete normalized response should be stored in the schedules table as jsonb with the schedule identity (year, month, anchor_date, anchor_day, seed).

**Validates: Requirements 19.1**

### Property 58: Schedule Cache Retrieval

*For any* schedule parameters, if a matching schedule exists in the schedules table and was generated within the last 24 hours, the cached schedule should be returned instead of calling the Scheduling API.

**Validates: Requirements 19.2**

### Property 59: Expected Shift Builder Creates Records

*For any* schedule from the Scheduling API, the Expected Shift Builder should create shift_attendance records with status='expected' and source='scheduler' for all assigned shifts.

**Validates: Requirements 20.1**

### Property 60: Expected Shift Builder Applies Exchanges

*For any* approved shift exchange, when building expected shifts, the system should delete the shift_attendance record for the from_employee (if it exists) and create a new shift_attendance record for the to_employee with status='expected' and source='shift_exchange'.

**Validates: Requirements 20.2**

### Property 61: Expected Shift Builder Idempotence

*For any* month, running the Expected Shift Builder multiple times should produce the same result without creating duplicate shift_attendance records.

**Validates: Requirements 20.3**

### Property 62: Expected Shift Builder Preserves Status

*For any* existing shift_attendance record with status='present', 'absent', or 'excused', rebuilding expected shifts should preserve the status and not reset it to 'expected'.

**Validates: Requirements 20.4**

### Property 63: Input Validation Against Schema

*For any* user input, the input should be validated against the appropriate Zod schema before any processing or database operations occur.

**Validates: Requirements 21.1**

### Property 64: Employee Reference Validation

*For any* operation referencing an employee_id or s_number, the validation should verify that the employee exists in the students table before proceeding.

**Validates: Requirements 21.2**

### Property 65: Date Format Validation

*For any* date input, the validation should ensure the date is in YYYY-MM-DD format and represents a valid calendar date.

**Validates: Requirements 21.3**

### Property 66: Shift Period Range Validation

*For any* shift period input, the validation should ensure the value is an integer between 0 and 8 (inclusive).

**Validates: Requirements 21.4**

### Property 67: Input Sanitization

*For any* text input, the input should be sanitized to prevent SQL injection and XSS attacks before being stored or displayed.

**Validates: Requirements 21.6**

### Property 68: Permission Check on Feature Access

*For any* feature access attempt, the system should check the user's permissions using the centralized permission checking function.

**Validates: Requirements 8.1**

### Property 69: Permission Flags Support

*For any* permission check, the system should support all defined permission flags: hr.schedule.view, hr.schedule.edit, hr.strikes.manage, hr.attendance.view, hr.attendance.override, hr.requests.view, hr.audit.view, hr.settings.edit.

**Validates: Requirements 8.2**

### Property 70: V1 Open Access Behavior

*For any* permission check in v1, the system should treat all permissions as granted and render all HR sections.

**Validates: Requirements 8.6**

### Property 71: Permission Checks on Both Client and Server

*For any* feature, permission checks should be implemented on both client-side (UI visibility) and server-side (data operations).

**Validates: Requirements 8.4**

### Property 72: Client-Side Read Operations

*For any* read operation for display purposes, the system should use client-side Supabase queries with the Anon_Key and RLS policies.

**Validates: Requirements 11.1**

### Property 73: Server-Side Write Operations

*For any* write or modify operation, the system should use server actions or API routes with the Service_Role_Key.

**Validates: Requirements 11.2**

### Property 74: Server-Side External API Calls

*For any* external API call (Scheduling_API, Meeting_Attendance_API), the system should execute the call server-side via Next.js route handlers, not directly from the browser.

**Validates: Requirements 11.3**

### Property 75: Schedule Cache Freshness Display

*For any* cached schedule displayed to the user, the system should display the generated_at timestamp to indicate cache freshness.

**Validates: Requirements 19.4**

### Property 76: Manual Cache Refresh

*For any* cached schedule, the system should provide a manual refresh button that bypasses the cache and fetches fresh schedule data from the Scheduling API.

**Validates: Requirements 19.5**

### Property 77: Expected Shift Builder Automatic Trigger

*For any* month with no existing shift_attendance records, fetching the schedule should automatically trigger the Expected Shift Builder.

**Validates: Requirements 20.5**

### Property 78: Expected Shift Builder Month Window

*For any* calendar month in America/Chicago timezone, the Expected Shift Builder should operate on that month's date range when creating or updating shift_attendance records.

**Validates: Requirements 20.7**

### Property 79: Permission Architecture Supports Roles

*For any* role defined in the user_roles table (employee, manager, HR_lead, exec), the system should support that role in permission checks.

**Validates: Requirements 8.3**

### Property 80: Unauthorized Action Logging

*For any* unauthorized action attempt (in future auth mode), the system should return an error and log the attempt in the audit_log.

**Validates: Requirements 8.8**

### Property 81: Service Role Key Server-Side Only

*For any* operation using the Service_Role_Key, the key should never be exposed to client-side code and should only be used in server actions and API routes.

**Validates: Requirements 16.3, 16.5**

### Property 82: Anon Key Client-Side Operations

*For any* client-side Supabase operation, the system should use the Anon_Key and enforce RLS policies.

**Validates: Requirements 16.4**

### Property 83: Environment Variable Validation

*For any* missing required environment variable (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY), the system should fail gracefully with a clear error message indicating which variable is required.

**Validates: Requirements 16.6**

## Error Handling

### Error Categories

**1. External API Errors**
- Network failures (timeout, connection refused)
- Invalid responses (schema validation failure)
- HTTP error status codes (4xx, 5xx)

**Handling Strategy**:
- Retry up to 3 times with exponential backoff (100ms, 200ms, 400ms)
- Log error with correlation ID
- Display user-friendly message: "Unable to fetch [schedule/meeting attendance] data. Please try again."
- Maintain current view state (don't clear existing data)
- If cached data is available, continue displaying it with a visible "stale" indicator

**2. Database Errors**
- Connection failures
- Constraint violations (unique, foreign key)
- Query timeouts

**Handling Strategy**:
- Log error with correlation ID and query details
- Display generic message: "An error occurred. Please try again."
- For constraint violations, display specific message: "This record already exists" or "Invalid employee reference"

**3. Validation Errors**
- Invalid input format
- Missing required fields
- Out-of-range values
- Invalid references

**Handling Strategy**:
- Return field-level error messages
- Display errors inline with form fields
- Prevent submission until validation passes
- Example: "Shift period must be between 0 and 8"

**4. Permission Errors** (future)
- Unauthorized access attempts
- Missing permissions

**Handling Strategy**:
- Log attempt in audit_log
- Return 403 Forbidden
- Display message: "You don't have permission to perform this action"

### Error Boundaries

**Global Error Boundary**:
- Catches unexpected React errors
- Displays fallback UI: "Something went wrong. Please refresh the page."
- Logs error to console (future: send to error tracking service)

**Component-Level Error Boundaries**:
- Wrap each major tab component
- Allows other tabs to continue functioning if one fails
- Displays error message within the failed tab only

### Retry Logic Implementation

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 100
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry failed');
}
```

## Testing Strategy

### Dual Testing Approach

The HR Module requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Verify specific examples, edge cases, and error conditions
- Specific schedule parameter combinations
- Edge cases: empty schedules, missing data, invalid dates, no exchanges
- Error conditions: API failures, validation errors, database constraints
- Integration points: API proxies, server actions, database queries
- Component rendering with specific data

**Property Tests**: Verify universal properties across all inputs
- Universal correctness properties (83 properties defined above)
- Comprehensive input coverage through randomization
- Minimum 100 iterations per property test

Together, unit tests catch concrete bugs while property tests verify general correctness across the input space.

### Property-Based Testing Configuration

**Library**: fast-check (TypeScript/JavaScript property-based testing library)

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: hr-module, Property {number}: {property_text}`
- Each correctness property implemented by a single property-based test

**Example Property Test Structure**:

```typescript
import fc from 'fast-check';

// Feature: hr-module, Property 11: Raw Meeting Attendance Rate Formula
test('raw meeting attendance rate calculation', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }), // attended_sessions
      fc.integer({ min: 1, max: 100 }), // total_sessions
      (attended, total) => {
        const rate = calculateRawMeetingAttendanceRate(attended, total);
        expect(rate).toBe((attended / total) * 100);
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: hr-module, Property 21: Off-Period Shift Identification
test('off-period shift classification', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }), // shift_period
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 0, maxLength: 8 }), // off_periods
      (period, offPeriods) => {
        const isOffPeriod = isOffPeriodShift(period, offPeriods);
        expect(isOffPeriod).toBe(offPeriods.includes(period));
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Organization

```
tests/
├── unit/
│   ├── components/
│   │   ├── ScheduleViewer.test.tsx
│   │   ├── EmployeeOverview.test.tsx
│   │   ├── EmployeeSettings.test.tsx
│   │   ├── StrikesManagement.test.tsx
│   │   ├── MeetingAttendanceDashboard.test.tsx
│   │   ├── ShiftAttendanceDashboard.test.tsx
│   │   ├── ShiftExchangeRequests.test.tsx
│   │   └── AuditLog.test.tsx
│   ├── lib/
│   │   ├── permissions.test.ts
│   │   ├── api-client.test.ts
│   │   ├── validation.test.ts
│   │   ├── calculations.test.ts
│   │   └── normalization.test.ts
│   └── actions/
│       ├── strikes.test.ts
│       ├── attendance.test.ts
│       ├── points.test.ts
│       ├── shift-requests.test.ts
│       ├── shift-attendance.test.ts
│       ├── employee-settings.test.ts
│       └── expected-shifts.test.ts
└── properties/
    ├── schedule.properties.test.ts
    ├── meeting-attendance.properties.test.ts
    ├── shift-attendance.properties.test.ts
    ├── strikes.properties.test.ts
    ├── points.properties.test.ts
    ├── audit.properties.test.ts
    ├── validation.properties.test.ts
    └── employee-settings.properties.test.ts
```

### Key Test Scenarios

**Schedule Integration**:
- Fetch schedule from API, verify caching and normalization
- Apply approved shift exchanges, verify effective worker updates
- Handle API failures, verify error display and retry logic

**Meeting Attendance**:
- Fetch meeting attendance from API
- Apply overrides (scope='meeting'), verify adjusted analytics
- Pardon/override meeting absences, verify override records

**Shift Attendance**:
- Build expected shifts from schedule
- Apply shift exchanges, verify expected worker changes
- Mark present/absent/excused, verify status updates
- Calculate raw and adjusted shift attendance rates

**Employee Settings**:
- Configure off-periods for employees
- Verify off-period shift classification
- Verify off-period shifts earn extra points

**Strikes Management**:
- Add strikes, verify database records and audit logs
- Remove strikes, verify soft delete
- Display only active strikes

**Shift Exchanges**:
- Submit exchange requests
- Approve exchanges, verify shift_attendance updates
- Deny exchanges, verify status updates
- Filter and paginate requests

**Points Tracking**:
- Award points for different activities (meeting, morning shift, off-period shift)
- Manual point adjustments
- Verify points summation and breakdown

**Audit Logging**:
- Verify audit entries for all modifications
- Test filtering by various criteria with pagination
- Verify field completeness and correlation IDs

**Validation**:
- Test all Zod schemas with valid and invalid inputs
- Verify error message specificity
- Test input sanitization

**Responsive & Accessibility**:
- Verify tab navigation and key actions are fully keyboard-accessible with visible focus states
- Verify mobile layout behavior below the `md` breakpoint (stacked content, usable controls)
- Verify minimum touch target sizing for tabs and primary actions (44×44px)
- Verify semantic structure and ARIA labels for icon-only controls

### Edge Cases to Test

1. Empty schedule (no shifts assigned)
2. Schedule with no approved exchanges
3. Employee with no off-periods configured (should default to [4, 8])
4. Employee with custom off-periods (e.g., [5])
5. Employee with no strikes, no points, no attendance
6. Meeting attendance with all present or all absent
7. Shift attendance with all expected, none marked
8. Duplicate override attempts (should update existing due to UNIQUE constraint)
9. Invalid employee references (s_number not in students table)
10. Invalid date formats and out-of-range periods
11. API responses with missing fields
12. Network timeouts and connection failures
13. Shift exchange from/to same employee (should be rejected)
14. Shift exchange for non-existent shift
15. Pagination at boundaries (first page, last page, empty results)

## Implementation Notes

### Environment Variables

Create `.env.example`:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# External APIs (no keys required)
# Scheduling API: https://scheduler-v2-gules.vercel.app/api/schedule
# Meeting Attendance API: https://hr-check-in-hnrx.vercel.app/api/report
```

### Theme Configuration

Create `tailwind.config.ts` with brand colors:

```typescript
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          maroon: '#800000',
        },
      },
      borderRadius: {
        none: '0',
      },
    },
  },
};
```

### UI Design Standards

- Use `#800000` (maroon) for primary actions, active tab indicators, and key accents
- Use rectangular corners everywhere (`rounded-none` / `border-radius: 0`)
- Use subtle transitions only (≤200ms) and avoid bouncy/spring-like motion
- Keep a minimal palette: neutral backgrounds with maroon accents and restrained status colors
- Maintain consistent spacing and typography across all HR tabs
- Ensure every interactive element has clear hover, active, disabled, and focus-visible states

### Responsive Layout and Accessibility

- Treat Tailwind `md` (768px) as the desktop breakpoint; below `md` is the mobile layout
- Stack sections and cards on mobile; use multi-column grids/tables on desktop where it improves scanability
- Ensure minimum 44×44px touch targets for buttons, tabs, checkboxes, and icon buttons (e.g., `min-h-[44px] min-w-[44px]`)
- Use semantic HTML (`nav`, `main`, `section`, `table`) and accessible labels/ARIA attributes for icons and controls
- Ensure keyboard navigation works across all tabs and forms with visible focus indicators (`focus-visible:*`)
- Maintain sufficient color contrast (≥4.5:1 for normal text), especially for maroon-on-neutral combinations

### Future Department Extensibility

- Organize features as self-contained modules (UI + server actions + queries + tests) to add new departments without rewrites
- Centralize permission flags/config and namespace by department (e.g., `hr.*`) so new roles/permissions are configuration-driven
- Avoid hard-coding department-specific logic in shared components; render navigation/tabs from a module registry

### Migration Execution Order

1. Create new tables in order:
   - strikes
   - shift_change_requests
   - points_ledger
   - audit_log
   - user_roles
   - attendance_overrides
   - schedules
   - employee_settings
   - shift_attendance
2. Create indexes for all tables
3. Create update triggers for updated_at columns
4. Enable RLS on all tables
5. Create allow-all policies for v1
6. Verify existing tables (students, attendance) are unchanged

### Performance Considerations

**Caching Strategy**:
- In-memory cache: React Query with staleTime (schedule: 1 hour, meeting attendance: 5 minutes)
- Database cache: schedules table only (24-hour TTL, display generated_at timestamp)
- Cache invalidation: manual refresh button, automatic on write operations

**Query Optimization**:
- All indexes defined in schema above
- Pagination for large result sets (audit log, shift exchange requests)
- Lazy loading for tab components
- Efficient joins using s_number for schedule/attendance operations

**Lazy Loading**:
- Tab components loaded only when activated
- Employee details loaded only when selected
- Audit log and requests loaded with pagination (50 entries per page)

### Future Enhancements

**When Authentication is Implemented**:
1. Replace getCurrentUser() to return actual user from session
2. Replace hasPermission() to check user_roles table
3. Update RLS policies from allow-all to role-based
4. Add login/logout UI (username/password, not email)
5. Update audit_log.user_id to store actual user IDs
6. Update *_by fields (issued_by, marked_by, etc.) to store actual user identifiers

**Potential Features**:
- Email/SMS notifications for shift exchange requests
- Bulk strike operations
- Points leaderboard and rewards system
- Attendance trends and analytics dashboards
- Schedule conflict detection
- Shift swap marketplace (employee-to-employee direct swaps)
- Mobile app for shift check-in
- Integration with calendar systems (Google Calendar, Outlook)
