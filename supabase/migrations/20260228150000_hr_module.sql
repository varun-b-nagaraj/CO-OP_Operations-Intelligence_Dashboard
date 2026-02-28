BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.strikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  reason TEXT NOT NULL,
  issued_by TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strikes_employee_active ON public.strikes(employee_id, active);

CREATE TABLE IF NOT EXISTS public.shift_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  from_employee_s_number TEXT NOT NULL,
  to_employee_s_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT shift_change_requests_from_to_distinct CHECK (from_employee_s_number <> to_employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_shift_change_status_date
  ON public.shift_change_requests(status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_change_one_approved_per_assignment
  ON public.shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_change_one_pending_per_assignment
  ON public.shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  point_type TEXT NOT NULL CHECK (point_type IN ('meeting', 'morning_shift', 'off_period_shift', 'project', 'manual')),
  points INTEGER NOT NULL,
  description TEXT,
  awarded_by TEXT,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_employee ON public.points_ledger(employee_id);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_timestamp ON public.audit_log(table_name, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'HR_lead', 'exec')),
  department TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s_number TEXT NOT NULL,
  checkin_date DATE NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('meeting', 'shift')),
  shift_period INTEGER CHECK (shift_period BETWEEN 0 AND 8),
  override_type TEXT NOT NULL CHECK (override_type IN ('excused', 'present_override')),
  reason TEXT NOT NULL,
  overridden_by TEXT,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_overrides_scope_period_consistency CHECK (
    (scope = 'meeting' AND shift_period IS NULL) OR
    (scope = 'shift' AND shift_period IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_lookup
  ON public.attendance_overrides(s_number, checkin_date);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_date
  ON public.attendance_overrides(checkin_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_overrides_meeting_unique
  ON public.attendance_overrides(s_number, checkin_date, scope)
  WHERE scope = 'meeting';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_overrides_shift_unique
  ON public.attendance_overrides(s_number, checkin_date, scope, shift_period)
  WHERE scope = 'shift';

CREATE TABLE IF NOT EXISTS public.schedules (
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

CREATE INDEX IF NOT EXISTS idx_schedules_lookup
  ON public.schedules(year, month, anchor_date, anchor_day, seed);

CREATE TABLE IF NOT EXISTS public.employee_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  employee_s_number TEXT NOT NULL,
  off_periods INTEGER[] NOT NULL DEFAULT '{4,8}'::integer[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id),
  UNIQUE(employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_employee_settings_snumber
  ON public.employee_settings(employee_s_number);

CREATE TABLE IF NOT EXISTS public.shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_shift_attendance_lookup
  ON public.shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_attendance_date_period
  ON public.shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_shift_attendance_slot
  ON public.shift_attendance(shift_date, shift_period, shift_slot_key);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_strikes_updated_at ON public.strikes;
CREATE TRIGGER update_strikes_updated_at
BEFORE UPDATE ON public.strikes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_roles_updated_at ON public.user_roles;
CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_schedules_updated_at ON public.schedules;
CREATE TRIGGER update_schedules_updated_at
BEFORE UPDATE ON public.schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_settings_updated_at ON public.employee_settings;
CREATE TRIGGER update_employee_settings_updated_at
BEFORE UPDATE ON public.employee_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_strikes ON public.strikes;
CREATE POLICY open_access_strikes
  ON public.strikes FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_shift_change_requests ON public.shift_change_requests;
CREATE POLICY open_access_shift_change_requests
  ON public.shift_change_requests FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_points_ledger ON public.points_ledger;
CREATE POLICY open_access_points_ledger
  ON public.points_ledger FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_audit_log ON public.audit_log;
CREATE POLICY open_access_audit_log
  ON public.audit_log FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_user_roles ON public.user_roles;
CREATE POLICY open_access_user_roles
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_attendance_overrides ON public.attendance_overrides;
CREATE POLICY open_access_attendance_overrides
  ON public.attendance_overrides FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_schedules ON public.schedules;
CREATE POLICY open_access_schedules
  ON public.schedules FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_employee_settings ON public.employee_settings;
CREATE POLICY open_access_employee_settings
  ON public.employee_settings FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_shift_attendance ON public.shift_attendance;
CREATE POLICY open_access_shift_attendance
  ON public.shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
