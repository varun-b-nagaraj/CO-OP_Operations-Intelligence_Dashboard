# Requirements Document: HR Module

## Introduction

The HR Module is a comprehensive human resources management system for the CO-OP Operations & Intelligence Portal. It serves approximately 100 student organization members by managing scheduling, shift attendance tracking, meeting attendance tracking, strikes, and employee data. The module integrates with two existing external APIs: the Scheduling API (generates monthly shift schedules) and the Meeting Attendance API (tracks bi-weekly morning meeting attendance). The system uses a Supabase PostgreSQL database with existing tables (students, attendance) that must remain unchanged. The system is built on Next.js (App Router) with Tailwind CSS.

The architecture uses Next.js route handlers and server actions as the backend layer (no separate backend service), with client-side Supabase queries for reads and server-side operations for writes.

In v1, the module operates in open-access mode while maintaining a permission-ready architecture for future user authentication and role-based enforcement. In v1, "authorized user" means any user (open access); in future auth mode, "authorized user" will mean a user who passes permission checks.

Existing tables (students, attendance) retain their current RLS configuration; new tables will ship with allow-all policies in v1. In v1, database fields referencing users (issued_by, overridden_by, awarded_by, marked_by, reviewed_by) may be null or set to a fixed identifier (e.g., 'open_access') until authentication is implemented.

V1 assumption: students and attendance tables are readable under current policies for anon/authenticated users; if not, reads for those tables will be proxied server-side.

## Glossary

- **HR_Module**: The human resources management system being developed
- **Scheduling_API**: External API at https://scheduler-v2-gules.vercel.app/api/schedule that generates monthly shift schedules for periods 1-3 and 5-7
- **Meeting_Attendance_API**: External API at https://hr-check-in-hnrx.vercel.app/api/report that provides morning meeting attendance data (every other Thursday before 1st period)
- **Employee**: A member of the CO-OP organization with a record in the students table
- **Strike**: A disciplinary record assigned to an employee for policy violations
- **Off_Period**: A period (1-8) designated as free time for a specific employee based on their class schedule (employee-specific, not global)
- **Off_Period_Shift**: A shift scheduled during a period that is in an employee's off_periods list
- **Morning_Shift**: A shift scheduled for period 0 (before 1st period)
- **Meeting_Attendance**: Attendance at bi-weekly morning meetings tracked by the Meeting_Attendance_API
- **Shift_Attendance**: Attendance at scheduled shifts (periods 0-8) tracked internally in the shift_attendance table
- **Expected_Worker**: The employee assigned to work a shift after accounting for approved shift exchanges
- **Shift_Exchange**: An approved shift change request that reassigns a shift from one employee to another
- **Points_System**: A reward system where employees earn points for meetings, morning shifts, off-period shifts, and projects
- **Permission_Gate**: An authorization check that controls access to features based on user roles
- **RLS**: Row Level Security - database-level access control enforced by PostgreSQL
- **Service_Role_Key**: Supabase administrative key that bypasses RLS, used only on server-side
- **Anon_Key**: Supabase public key for client-side reads, enforces RLS policies
- **Audit_Log**: A record of all data modifications with timestamp, user, and action details

## Requirements

### Requirement 1: Schedule Viewing and Generation

**User Story:** As an HR team member, I want to view and generate monthly schedules, so that I can plan shift coverage and track shift assignments.

#### Acceptance Criteria

1. WHEN an authorized user requests a monthly schedule, THE HR_Module SHALL fetch schedule data from the Scheduling_API with configurable year, month, anchorDate, anchorDay, and seed parameters
2. WHEN the Scheduling_API returns schedule data, THE HR_Module SHALL display the calendar view, shift assignments, roster, summary, and statistics
3. WHEN displaying shift assignments, THE HR_Module SHALL overlay approved shift exchanges to show the effective worker for each shift (approved exchanges are shift_change_requests records with status='approved')
4. WHEN displaying a shift assignment for an employee, THE HR_Module SHALL visually indicate if the shift period is in that employee's off_periods list
5. WHEN the Scheduling_API request fails, THE HR_Module SHALL display an error message and maintain the current view state
6. THE HR_Module SHALL cache schedule data in-memory for the current session to minimize redundant API calls
7. WHEN displaying the schedule, THE HR_Module SHALL use the brand color #800000 for primary accents and rectangular corners (border-radius: 0) for all UI elements

### Requirement 2: Employee Overview and Data Management

**User Story:** As an HR team member, I want to view comprehensive employee information, so that I can track performance metrics and manage employee data.

#### Acceptance Criteria

1. WHEN an authorized user views the employee overview, THE HR_Module SHALL display a list of all employees with name, strikes count, meeting attendance rate, shift attendance rate, total shifts, morning shifts, off-period shifts, and points
2. Total scheduled shifts SHALL be the count of all shift_attendance records for the employee for the selected date range (regardless of status)
3. Morning shifts SHALL be the count of shift_attendance records with shift_period=0 and status='present' for the employee
4. Off-period shifts SHALL be the count of shift_attendance records where shift_period is in the employee's off_periods list and status='present'
5. WHEN calculating meeting attendance rate, THE HR_Module SHALL derive total_sessions from Meeting_Attendance_API and attended_sessions from Meeting_Attendance_API present_count merged with attendance_overrides where scope='meeting'
6. WHEN calculating raw meeting attendance rate, THE HR_Module SHALL compute the percentage as (attended_sessions / total_sessions) * 100
7. WHEN calculating adjusted meeting attendance rate, THE HR_Module SHALL compute the percentage as (attended_sessions / (total_sessions - excused_absences)) * 100
8. WHEN calculating shift attendance rate, THE HR_Module SHALL derive scheduled shifts as the count of all shift_attendance records for the employee for the selected date range (regardless of status), attended shifts as the count with status='present', and excused shifts as the count with status='excused'
9. WHEN calculating raw shift attendance rate, THE HR_Module SHALL compute the percentage as (attended_shifts / scheduled_shifts) * 100
10. WHEN calculating adjusted shift attendance rate, THE HR_Module SHALL compute the percentage as (attended_shifts / (scheduled_shifts - excused_shifts)) * 100
11. WHEN meeting or shift data is unavailable for a date range, THE HR_Module SHALL display the respective attendance rate as "N/A" rather than 0
12. WHEN calculating points, THE HR_Module SHALL sum points from meetings attended, morning shifts, off-period shifts, and project contributions
13. WHEN an authorized user selects an employee, THE HR_Module SHALL display detailed information including username, assigned periods, and off_periods configuration
14. THE HR_Module SHALL retrieve employee data using Supabase policies that are allow-all in v1 and can be tightened for role-based enforcement in future versions
15. THE HR_Module SHALL retrieve employee base data from the existing students table without modifying its schema

### Requirement 3: Employee Settings and Off-Period Configuration

**User Story:** As an HR team member, I want to configure each employee's off-periods, so that I can track which shifts are during their free periods.

#### Acceptance Criteria

1. THE HR_Module SHALL store employee off-period configuration in an employee_settings table with employee_id, employee_s_number, and off_periods array
2. WHEN an authorized user updates an employee's off-periods, THE HR_Module SHALL update the employee_settings record
3. THE HR_Module SHALL default off_periods to [4, 8] for new employees
4. THE HR_Module SHALL allow off_periods to be any combination of periods 1-8
5. WHEN displaying an employee's schedule, THE HR_Module SHALL use the employee's off_periods configuration to identify off-period shifts
6. WHEN an employee works a shift during one of their off_periods, THE HR_Module SHALL count it as an off-period shift for points calculation

### Requirement 4: Strikes Management

**User Story:** As an HR lead, I want to add and remove strikes for employees, so that I can enforce policies and track disciplinary actions.

#### Acceptance Criteria

1. WHEN an authorized user adds a strike to an employee, THE HR_Module SHALL create a new record in the strikes table with employee_id, reason, issued_by, issued_at, and active status
2. WHEN an authorized user removes a strike, THE HR_Module SHALL mark the strike record as inactive rather than deleting it
3. WHEN displaying employee strikes, THE HR_Module SHALL show only active strikes in the count
4. WHEN a strike is added or removed, THE HR_Module SHALL create an audit_log entry recording the action, user, timestamp, and affected employee
5. WHEN strike data is modified, THE HR_Module SHALL use server-side operations with the Service_Role_Key
6. WHEN displaying strikes, THE HR_Module SHALL show the reason, date issued, and issuing user for each active strike

### Requirement 5: Meeting Attendance Dashboard

**User Story:** As an HR team member, I want to view morning meeting attendance analytics and manage absences, so that I can track meeting participation and handle exceptional circumstances.

#### Acceptance Criteria

1. WHEN an authorized user requests meeting attendance data, THE HR_Module SHALL fetch data from the Meeting_Attendance_API with configurable date range parameters
2. WHEN the Meeting_Attendance_API returns data, THE HR_Module SHALL display analytics including total students, total sessions, average attendance, and per-student breakdown
3. WHEN displaying per-student meeting attendance, THE HR_Module SHALL show name, s_number, present_count, absent_count, and attendance_rate
4. WHEN an authorized user pardons a meeting absence, THE HR_Module SHALL create or update an attendance_overrides record with scope='meeting' and override_type='excused'
5. WHEN an authorized user overrides a meeting attendance record, THE HR_Module SHALL create or update an attendance_overrides record with scope='meeting' and override_type='present_override'
6. WHEN meeting attendance data is modified, THE HR_Module SHALL use server-side operations with the Service_Role_Key
7. WHEN the Meeting_Attendance_API request fails, THE HR_Module SHALL display an error message and maintain the current view state

### Requirement 6: Shift Attendance Tracking

**User Story:** As an HR team member, I want to track attendance for all scheduled shifts, so that I can monitor shift coverage and employee reliability.

#### Acceptance Criteria

1. THE HR_Module SHALL store shift attendance records in a shift_attendance table with shift_date, shift_period, employee_s_number, status, source, reason, marked_by, and marked_at
2. WHEN expected shifts are built, THE HR_Module SHALL create shift_attendance records with status='expected' for all assigned shifts
3. WHEN a shift exchange is approved, THE HR_Module SHALL delete the shift_attendance record for the from_employee and create a new record for the to_employee with status='expected' and source='shift_exchange'
4. WHEN an employee attends a shift, THE HR_Module SHALL update the shift_attendance record status to 'present'
5. WHEN an employee misses a shift, THE HR_Module SHALL update the shift_attendance record status to 'absent'
6. WHEN an absence is excused, THE HR_Module SHALL update the shift_attendance record status to 'excused'
7. THE HR_Module SHALL support shift_period values from 0 to 8 (0 for morning shifts, 1-8 for regular periods)
8. THE HR_Module SHALL enforce a UNIQUE constraint on (shift_date, shift_period, employee_s_number) in the shift_attendance table

### Requirement 7: Shift Exchange Management

**User Story:** As an employee, I want to exchange shifts with another employee when I cannot make my scheduled shift, so that coverage is maintained.

#### Acceptance Criteria

1. WHEN an employee submits a shift exchange request, THE HR_Module SHALL create a record in the shift_change_requests table with shift_date, shift_period, from_employee_s_number, to_employee_s_number, reason, and status='pending'
2. WHEN an HR team member views shift exchange requests, THE HR_Module SHALL display all pending requests with from/to employee names, shift details, and reason
3. WHEN an HR team member approves a shift exchange, THE HR_Module SHALL update the request status to 'approved', reassign the expected shift by deleting the from_employee shift_attendance record and creating a new to_employee shift_attendance record with status='expected' and source='shift_exchange' (Implementation: delete the from_employee row if it exists; upsert the to_employee row on conflict with (shift_date, shift_period, employee_s_number)), and record the reviewer and timestamp
4. WHEN approving a shift exchange where the from_employee shift_attendance record has status in ('present','absent','excused'), THE HR_Module SHALL reject the exchange approval (v1 behavior; future versions may support explicit override workflow)
5. WHEN an HR team member denies a shift exchange, THE HR_Module SHALL update the request status to 'denied' and record the reviewer and timestamp
6. WHEN a shift exchange is processed, THE HR_Module SHALL create an audit_log entry
7. THE HR_Module SHALL allow filtering shift exchange requests by status (pending, approved, denied)
8. THE HR_Module SHALL implement pagination for shift exchange requests with a default limit of 50 entries per page
9. WHEN displaying shift exchange requests, THE HR_Module SHALL sort by requested_at timestamp in descending order

### Requirement 8: Permission-Ready Architecture

**User Story:** As a system architect, I want all features behind permission gates, so that role-based access control can be enabled without code rewrites.

#### Acceptance Criteria

1. WHEN any feature is accessed, THE HR_Module SHALL check the user's permissions using a centralized permission checking function
2. THE HR_Module SHALL support these permission flags: hr.schedule.view, hr.schedule.edit, hr.strikes.manage, hr.attendance.view, hr.attendance.override, hr.requests.view, hr.audit.view, hr.settings.edit
3. THE HR_Module SHALL support these roles: employee, manager, HR_lead, exec
4. THE HR_Module SHALL implement permission checks on both client-side (UI visibility) and server-side (data operations)
5. THE HR_Module SHALL store user roles and permissions schema in the user_roles table for future use
6. IN v1 (open access), THE HR_Module SHALL treat all permissions as granted and SHALL render all HR sections
7. WHEN authentication is implemented, THE HR_Module SHALL use deny-by-default behavior and hide all HR sections unless the user has required permissions
8. WHEN a user attempts an unauthorized action (in future auth mode), THE HR_Module SHALL return an error and log the attempt in the audit_log

### Requirement 9: Database Schema and Migrations

**User Story:** As a database administrator, I want complete SQL migrations for new tables, so that the database schema supports all HR module features while preserving existing data.

#### Acceptance Criteria

1. THE HR_Module SHALL create a strikes table with columns: id (uuid), employee_id (uuid references students.id), reason (text), issued_by (text nullable), issued_at (timestamp), active (boolean), created_at (timestamp), updated_at (timestamp)
2. THE HR_Module SHALL create a shift_change_requests table with columns: id (uuid), shift_date (date), shift_period (integer 0-8), from_employee_s_number (text), to_employee_s_number (text), reason (text), status (enum: pending/approved/denied), requested_at (timestamp), reviewed_by (text nullable), reviewed_at (timestamp nullable)
3. THE HR_Module SHALL create a points_ledger table with columns: id (uuid), employee_id (uuid references students.id), point_type (enum: meeting/morning_shift/off_period_shift/project/manual), points (integer), description (text), awarded_by (text nullable), awarded_at (timestamp)
4. THE HR_Module SHALL create an audit_log table with columns: id (uuid), user_id (text nullable), action (text), table_name (text), record_id (text), old_value (jsonb), new_value (jsonb), timestamp (timestamp)
5. THE HR_Module SHALL create a user_roles table with columns: id (uuid), user_id (text), role (enum: employee/manager/HR_lead/exec), department (text), permissions (jsonb), created_at (timestamp), updated_at (timestamp)
6. THE HR_Module SHALL create an attendance_overrides table with columns: id (uuid), s_number (text), checkin_date (date), scope (enum: meeting/shift), shift_period (integer nullable 0-8), override_type (enum: excused/present_override), reason (text), overridden_by (text nullable), overridden_at (timestamp)
7. THE HR_Module SHALL enforce a partial UNIQUE index on (s_number, checkin_date, scope) WHERE scope='meeting' for meeting attendance overrides
8. THE HR_Module SHALL enforce a partial UNIQUE index on (s_number, checkin_date, scope, shift_period) WHERE scope='shift' for shift attendance overrides
9. THE HR_Module SHALL create a schedules table with columns: id (uuid), year (integer), month (integer 1-12), anchor_date (date), anchor_day (text A/B), seed (integer), schedule_data (jsonb), generated_at (timestamp), created_at (timestamp), updated_at (timestamp)
10. THE HR_Module SHALL enforce a UNIQUE constraint on (year, month, anchor_date, anchor_day, seed) in the schedules table
11. THE HR_Module SHALL create an employee_settings table with columns: id (uuid), employee_id (uuid references students.id), employee_s_number (text), off_periods (integer array), created_at (timestamp), updated_at (timestamp)
12. THE HR_Module SHALL enforce UNIQUE constraints on both employee_id and employee_s_number in the employee_settings table
13. THE HR_Module SHALL create a shift_attendance table with columns: id (uuid), shift_date (date), shift_period (integer 0-8), employee_s_number (text), status (enum: expected/present/absent/excused), source (enum: scheduler/manual/shift_exchange/rebuild), reason (text nullable), marked_by (text nullable), marked_at (timestamp)
14. THE HR_Module SHALL enforce a UNIQUE constraint on (shift_date, shift_period, employee_s_number) in the shift_attendance table
15. THE HR_Module SHALL implement RLS policies for each new table that allow full access in v1 while supporting future role-based enforcement
16. THE HR_Module SHALL create indexes: strikes(employee_id, active), points_ledger(employee_id), attendance_overrides(s_number, checkin_date), attendance_overrides(checkin_date), audit_log(timestamp DESC), audit_log(table_name, timestamp DESC), schedules(year, month, anchor_date, anchor_day, seed), employee_settings(employee_s_number), shift_attendance(employee_s_number, shift_date), shift_attendance(shift_date, shift_period), shift_change_requests(status, requested_at DESC)
17. THE HR_Module SHALL create update triggers for updated_at columns on strikes, user_roles, schedules, and employee_settings tables
18. THE HR_Module SHALL provide migration files that can be executed without affecting existing students and attendance tables

### Requirement 10: Authentication and User Isolation (Deferred)

**User Story:** As a developer, I want the system to work without authentication initially while being ready for future auth implementation, so that we can ship quickly and add security later.

#### Acceptance Criteria

1. THE HR_Module SHALL ship without end-user authentication in v1, providing open access to all users
2. THE HR_Module SHALL define interfaces and hooks for authentication and permission resolution (getCurrentUser(), hasPermission(flag))
3. THE HR_Module SHALL default to allow-all behavior for permission checks until authentication is implemented
4. THE HR_Module SHALL be compatible with a future username and password login system (not email-based) to be implemented at a later date
5. WHEN authentication is introduced, THE HR_Module SHALL create a session, identify the current user, and load role and permissions from the user_roles table
6. WHEN authentication is introduced, THE HR_Module SHALL enforce per-user database access isolation using RLS policies
7. THE HR_Module SHALL use Next.js server actions and route handlers for privileged operations, even in v1 open-access mode, to establish the security boundary pattern

### Requirement 11: Data Flow and API Integration

**User Story:** As a developer, I want clear separation between client and server operations, so that security boundaries are maintained and the system is scalable.

#### Acceptance Criteria

1. WHEN reading data for display, THE HR_Module SHALL use client-side Supabase queries with the Anon_Key and RLS policies set to allow-all in v1 and ready to be tightened once auth is enabled
2. WHEN writing or modifying data, THE HR_Module SHALL use server actions or API routes with the Service_Role_Key
3. WHEN calling external APIs (Scheduling_API, Meeting_Attendance_API), THE HR_Module SHALL execute calls server-side via Next.js route handlers (not directly from browser)
4. WHEN external API calls fail, THE HR_Module SHALL implement retry logic with exponential backoff up to 3 attempts
5. WHEN caching external API responses, THE HR_Module SHALL cache schedule data for 1 hour in-memory and 24 hours in database, and meeting attendance data for 5 minutes in-memory only
6. THE HR_Module SHALL validate all API responses against expected schemas before processing
7. WHEN API response validation fails, THE HR_Module SHALL log the error and return a user-friendly error message
8. THE HR_Module SHALL implement server-side route handlers for Scheduling_API and Meeting_Attendance_API to support caching and retry logic

### Requirement 12: User Interface Design Standards

**User Story:** As a user, I want a clean and consistent interface, so that the HR module feels cohesive with the organization's brand.

#### Acceptance Criteria

1. THE HR_Module SHALL use #800000 (maroon) as the primary brand color for buttons, accents, and interactive elements
2. THE HR_Module SHALL use border-radius: 0 for all UI components to maintain rectangular corners
3. THE HR_Module SHALL implement subtle animations with durations under 200ms for state transitions
4. THE HR_Module SHALL avoid bouncy or exaggerated animations
5. THE HR_Module SHALL use a minimal color palette with maroon accents on neutral backgrounds
6. THE HR_Module SHALL ensure all interactive elements have clear hover and active states
7. THE HR_Module SHALL maintain consistent spacing and typography throughout the module

### Requirement 13: Single Page Architecture

**User Story:** As a user, I want all HR features accessible from a single page, so that I can quickly navigate between different HR functions.

#### Acceptance Criteria

1. THE HR_Module SHALL serve all features at a single route /hr
2. THE HR_Module SHALL provide internal tabs for navigation: Schedule, Employees, Settings, Strikes, Meeting Attendance, Shift Attendance, Requests, Audit
3. WHEN switching between tabs, THE HR_Module SHALL toggle section visibility using client-side state without full page reloads or route changes
4. WHEN a tab is active, THE HR_Module SHALL visually indicate the active state with maroon accent color
5. THE HR_Module SHALL lazy-load inactive tab components to optimize initial page load time
6. WHEN the page loads, THE HR_Module SHALL display the Schedule tab by default
7. THE HR_Module SHALL preserve scroll position when switching between tabs
8. THE HR_Module SHALL optionally support URL query parameters (e.g., ?tab=schedule) for deep linking to specific tabs

### Requirement 14: Points Tracking System

**User Story:** As an HR lead, I want to track employee points for meetings, shifts, and projects, so that I can recognize and reward contributions.

#### Acceptance Criteria

1. WHEN an employee attends a meeting, THE HR_Module SHALL add 1 point to their points_ledger with point_type='meeting'
2. WHEN an employee completes a morning shift (period 0), THE HR_Module SHALL add 1 point to their points_ledger with point_type='morning_shift'
3. WHEN an employee completes an off-period shift, THE HR_Module SHALL add 1 point to their points_ledger with point_type='off_period_shift'
4. WHEN points are awarded, THE HR_Module SHALL record the point_type, description, and awarding user in the points_ledger
5. WHEN calculating total points for an employee, THE HR_Module SHALL sum all point entries from the points_ledger
6. THE HR_Module SHALL allow authorized users to manually add or subtract points with point_type='manual' and a description
7. WHEN displaying points, THE HR_Module SHALL show a breakdown by point_type (meeting, morning_shift, off_period_shift, project, manual)

### Requirement 15: Audit Logging and Transparency

**User Story:** As an executive, I want to see all data modifications in an audit log, so that I can ensure accountability and investigate issues.

#### Acceptance Criteria

1. WHEN any data modification occurs (strikes, attendance overrides, points, shift exchanges, shift attendance, employee settings), THE HR_Module SHALL create an audit_log entry
2. THE HR_Module SHALL record the user_id, action type, table_name, record_id, old_value (jsonb), new_value (jsonb), and timestamp for each audit entry
3. IN v1 (open access), THE HR_Module SHALL set audit_log.user_id to null or a fixed system identifier (e.g., 'open_access') until authentication is implemented
4. WHEN an authorized user views the audit log, THE HR_Module SHALL display entries with user name, action description, timestamp, and affected record
5. THE HR_Module SHALL allow filtering audit log entries by date range, user, action type, and table
6. THE HR_Module SHALL implement pagination for audit log entries with a default limit of 50 entries per page and cursor-based pagination using (timestamp, id)
7. THE HR_Module SHALL enforce a maximum date range filter window of 1 year to prevent scanning excessively large audit log tables
8. THE HR_Module SHALL implement audit log writes using server-side operations with the Service_Role_Key
9. THE HR_Module SHALL retain audit log entries indefinitely for compliance and historical tracking

### Requirement 16: Environment Configuration and Security

**User Story:** As a developer, I want clear environment configuration, so that I can securely deploy the application with proper API keys and database credentials.

#### Acceptance Criteria

1. THE HR_Module SHALL require these environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
2. THE HR_Module SHALL provide a .env.example file documenting all required environment variables with descriptions
3. THE HR_Module SHALL never expose the Service_Role_Key to client-side code
4. THE HR_Module SHALL use the Anon_Key for all client-side Supabase operations
5. THE HR_Module SHALL use the Service_Role_Key only in server actions and API routes
6. WHEN environment variables are missing, THE HR_Module SHALL fail gracefully with clear error messages indicating which variables are required

### Requirement 17: Error Handling and Resilience

**User Story:** As a user, I want the system to handle errors gracefully, so that temporary issues don't disrupt my workflow.

#### Acceptance Criteria

1. WHEN an external API call fails, THE HR_Module SHALL display a user-friendly error message without exposing technical details
2. WHEN a database operation fails, THE HR_Module SHALL log the error with correlation ID and display a generic error message to the user
3. WHEN network connectivity is lost, THE HR_Module SHALL display cached data with a visual indicator that data may be stale
4. WHEN validation errors occur, THE HR_Module SHALL display specific field-level error messages to guide the user
5. THE HR_Module SHALL implement global error boundaries to catch and handle unexpected React errors
6. WHEN server-side errors occur, THE HR_Module SHALL return appropriate HTTP status codes (400 for validation, 401 for auth, 403 for permissions, 500 for server errors)

### Requirement 18: Responsive Layout and Accessibility

**User Story:** As a user on different devices, I want the HR module to work on desktop and mobile, so that I can access HR features anywhere.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE HR_Module SHALL adapt the layout for mobile viewing with stacked sections
2. WHEN the viewport width is 768px or above, THE HR_Module SHALL display the desktop layout with side-by-side sections
3. THE HR_Module SHALL ensure all interactive elements have minimum touch target sizes of 44x44 pixels for mobile usability
4. THE HR_Module SHALL use semantic HTML elements for proper screen reader support
5. THE HR_Module SHALL ensure sufficient color contrast ratios (minimum 4.5:1 for normal text) for readability
6. WHEN keyboard navigation is used, THE HR_Module SHALL provide visible focus indicators for all interactive elements

### Requirement 19: Schedule Data Persistence and Caching

**User Story:** As an HR team member, I want schedule data cached efficiently, so that the system is responsive and minimizes external API calls.

#### Acceptance Criteria

1. THE HR_Module SHALL store complete schedule responses from the Scheduling_API in the schedules table as jsonb for persistent cross-session caching
2. WHEN the same schedule parameters are requested again, THE HR_Module SHALL retrieve the schedule from the schedules table if it was generated within the last 24 hours
3. THE HR_Module SHALL maintain in-memory session cache using React Query with 1-hour staleTime for immediate reuse
4. WHEN a schedule is fetched, THE HR_Module SHALL display the generated_at timestamp to indicate cache freshness
5. THE HR_Module SHALL provide a manual refresh button to bypass cache and fetch fresh schedule data

### Requirement 20: Expected Shift Builder

**User Story:** As an HR team member, I want the system to automatically track expected shift workers, so that shift exchanges are properly reflected in attendance tracking.

#### Acceptance Criteria

1. WHEN an authorized user clicks "Build Expected Shifts" for a month, THE HR_Module SHALL fetch the schedule and create shift_attendance records with status='expected' for all assigned shifts
2. WHEN a shift exchange is approved, THE HR_Module SHALL delete the shift_attendance record for the from_employee and create a new shift_attendance record for the to_employee with status='expected' and source='shift_exchange'
3. THE HR_Module SHALL implement the Expected Shift Builder as an idempotent operation that can be run multiple times without creating duplicates (using UPSERT/ON CONFLICT)
4. WHEN rebuilding expected shifts, THE HR_Module SHALL preserve existing shift_attendance records with status='present' or 'absent' (do not overwrite)
5. THE HR_Module SHALL automatically trigger the Expected Shift Builder only if no shift_attendance records exist for that month; the "Build Expected Shifts" button forces rebuild regardless
6. IN v1, the Expected Shift Builder SHALL operate on a calendar-month window; re-running with different schedule parameters MAY replace prior expected assignments for that month, but SHALL NOT overwrite records already marked present/absent/excused
7. THE HR_Module SHALL define "month" as calendar month in America/Chicago timezone for date range calculations

### Requirement 21: Data Validation and Integrity

**User Story:** As a developer, I want all data validated before database operations, so that data integrity is maintained.

#### Acceptance Criteria

1. WHEN receiving user input, THE HR_Module SHALL validate it against a Zod schema before processing
2. WHEN validating employee_id or s_number references, THE HR_Module SHALL verify the employee exists in the students table
3. WHEN validating date inputs, THE HR_Module SHALL ensure dates are in YYYY-MM-DD format and represent valid calendar dates
4. WHEN validating shift periods, THE HR_Module SHALL ensure period numbers are integers between 0 and 8
5. WHEN validation fails, THE HR_Module SHALL return specific error messages indicating which fields are invalid and why
6. THE HR_Module SHALL sanitize all text inputs to prevent SQL injection and XSS attacks
7. WHEN writing to the database, THE HR_Module SHALL use parameterized queries or ORM methods to prevent injection attacks

### Requirement 22: Future Department Extensibility

**User Story:** As a system architect, I want the HR module architecture to support future department additions, so that the system can scale without major rewrites.

#### Acceptance Criteria

1. THE HR_Module SHALL use a modular component structure where features are self-contained
2. THE HR_Module SHALL define clear interfaces for permission checking that can be extended for new departments
3. THE HR_Module SHALL use a centralized permission configuration that can be updated without modifying feature code
4. WHEN new roles are added to the user_roles table, THE HR_Module SHALL recognize them without code changes
5. THE HR_Module SHALL use a plugin-style architecture where new features can be added as separate modules
6. THE HR_Module SHALL avoid hard-coding department-specific logic in shared components

## Technical Constraints

1. **Stack**: Next.js (App Router), TypeScript, Tailwind CSS, Supabase (PostgreSQL)
2. **External APIs**: Scheduling API and Meeting Attendance API must remain unchanged
3. **Existing Tables**: students and attendance tables must not be modified
4. **Security (v1)**: Service_Role_Key only on server; Anon_Key on client; RLS policies set to allow-all while keeping future enforcement ready
5. **Styling**: Brand color #800000, border-radius: 0, minimal animations
6. **Architecture**: Single page with tab/section navigation
7. **Testing**: Property-based tests for data operations, unit tests for UI components

## Clarifications and Design Decisions

### 1. Attendance Model: Two Distinct Systems

**Meeting Attendance** (Meeting_Attendance_API):
- Tracks bi-weekly morning meetings (every other Thursday)
- Data source: External Meeting Attendance API
- Overrides: attendance_overrides with scope='meeting'
- Metrics: meeting attendance rate
- Points: 1 point per meeting attended (point_type='meeting')

**Shift Attendance** (Internal):
- Tracks all scheduled shifts (periods 0-8)
- Period 0: Special morning work shifts (NOT the bi-weekly meetings)
- Periods 1-3, 5-7: Regular shifts from Scheduling API
- Data source: Internal shift_attendance table
- Expected workers derived from: Scheduling API + approved shift exchanges
- Overrides: attendance_overrides with scope='shift' for excusals (v1: use shift_attendance.status directly instead)
- Metrics: shift attendance rate
- Points: 1 point for morning shifts (period 0 with status='present'), 1 point for off-period shifts (status='present' and period in employee's off_periods)

**Important**: Meeting attendance (bi-weekly meetings) and morning shift attendance (period 0 shifts) are separate. Meeting attendance awards meeting points; period 0 shift attendance awards morning_shift points. They do not overlap or double-award. Period 0 shifts are for special morning work shifts, not the regular bi-weekly meetings.

These are separate systems with separate metrics and should not be conflated.

### 2. Off-Period Classification: Employee-Specific

- Off-periods are NOT globally periods 4 and 8
- Each employee has their own off_periods configuration stored in employee_settings
- Default off_periods: [4, 8]
- Some employees may have different off-periods (e.g., [5])
- A shift is an "off-period shift" for an employee if shift_period is in that employee's off_periods array
- This is used for: visual indicators in schedule view, points calculation (off-period shifts earn extra points)

### 3. Morning Shift Definition

- Morning shifts are shifts with period 0 (before 1st period)
- The Scheduling API returns periods 1-3 and 5-7 only (no period 0)
- Morning shifts (period 0) are special morning work shifts, NOT the bi-weekly meetings
- Morning shifts are tracked in shift_attendance with shift_period=0
- Morning shifts can be created manually or through special scheduling
- Morning shifts earn 1 point when completed (point_type='morning_shift')

### 4. Shift Exchange Model

- Shift exchanges involve two employees swapping or transferring a shift
- from_employee_s_number: Original worker assigned by scheduler
- to_employee_s_number: New worker taking the shift
- When approved: Delete shift_attendance record for from_employee, create new record for to_employee
- This maintains the UNIQUE constraint on (shift_date, shift_period, employee_s_number)
- When approved: shift_attendance expected worker changes from "from" to "to"
- This ensures attendance tracking reflects the actual expected worker

### 5. Expected Shift Builder

- After generating a schedule, the system creates shift_attendance records with status='expected'
- When shift exchanges are approved, expected worker is updated
- This provides a single source of truth for "who should work this shift"
- Attendance marking (present/absent) updates these same records

### 6. Attendance Overrides Scope

- attendance_overrides supports ONLY meeting attendance overrides in v1
- scope='meeting': Overrides for Meeting Attendance API data (keyed by date only, shift_period is null)
- scope='shift': Reserved for future shift attendance overrides (not implemented in v1)
- Meeting overrides UNIQUE constraint: (s_number, checkin_date, scope) WHERE scope='meeting' (partial unique index)
- Shift overrides UNIQUE constraint: (s_number, checkin_date, scope, shift_period) WHERE scope='shift' (partial unique index)
- In v1, shift attendance excusals are handled directly in shift_attendance.status='excused' (no separate override table entry)
- This simplifies the model: meeting overrides use attendance_overrides, shift excusals update shift_attendance status directly

### 7. External API Calling Pattern

- All calls to Scheduling_API and Meeting_Attendance_API SHALL be executed server-side via Next.js route handlers
- Server-side route handlers are part of the Next.js application, not a separate backend service
- External APIs SHALL NOT be called directly from client-side code
- Server-side route handlers SHALL implement caching and retry logic
- Cache TTL: Schedule data cached 1 hour in-memory (React Query), 24 hours in database; Meeting attendance data cached 5 minutes in-memory only (no database persistence)

### 8. Single-Page HR Navigation Pattern

- The HR module SHALL be served at a single route: /hr
- All HR features SHALL be accessible via internal tab navigation: Schedule | Employees | Settings | Strikes | Meeting Attendance | Shift Attendance | Requests | Audit
- Tab switching SHALL use client-side state management (React state or URL query params like ?tab=schedule)
- Tab switching SHALL NOT trigger route changes or full page reloads
- Inactive tab content SHALL be lazy-loaded to optimize performance
- Scroll position SHALL be preserved when switching between tabs

### 9. Permission Default Behavior

- The HR module SHALL operate in open access mode in v1, granting full read and write access to all users
- All permission checks SHALL default to allow-all behavior
- Row Level Security (RLS) policies SHALL be configured to allow full access in v1 (using (true) with check (true) for both anon and authenticated roles)
- The schema and policy structure SHALL support future enforcement without requiring database restructuring
- WHEN authentication is implemented, the system SHALL support per-user access control and row-level isolation

## Success Criteria

1. All features accessible from a single HR module page with 8 tabs
2. Complete integration with both external APIs (Scheduling and Meeting Attendance)
3. Separate tracking for meeting attendance vs shift attendance
4. Employee-specific off-period configuration
5. Shift exchange system with expected worker tracking
6. All database operations respect RLS policies (allow-all in v1)
7. Permission gates in place for all features (allow-all in v1)
8. Complete SQL migrations provided with indexes and triggers
9. Clean, minimal UI following brand guidelines (#800000 maroon, rectangular corners)
10. Mobile-responsive design
11. Comprehensive test coverage (property-based + unit tests)

## Non-Goals for v1

1. **User Authentication**: No login system in v1 (open access)
2. **Email/SMS Notifications**: No automated notifications for shift exchanges or strikes
3. **Mobile App**: Web-only, though responsive design supports mobile browsers
4. **Calendar Integration**: No sync with Google Calendar or Outlook
5. **Shift Marketplace**: No employee-to-employee direct shift swapping (only HR-approved exchanges)
6. **Performance Metrics**: No advanced analytics or trend dashboards
7. **Bulk Operations**: No bulk strike assignment or bulk point awards
8. **Historical Data Migration**: Existing attendance table data not migrated to new shift_attendance table
9. **Real-time Updates**: No WebSocket or real-time sync (manual refresh required)
10. **Export Features**: No CSV/Excel export functionality

