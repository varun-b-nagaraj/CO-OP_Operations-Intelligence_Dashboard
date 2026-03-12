BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id UUID NOT NULL UNIQUE
    REFERENCES public.general_department_calendar_events(id) ON DELETE CASCADE,
  check_date DATE NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NULL,
  location TEXT NULL,
  notes TEXT NULL,
  capacity INTEGER NULL CHECK (capacity IS NULL OR capacity > 0),
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_checks_starts_at
  ON public.inventory_checks(starts_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_check_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_check_id UUID NOT NULL
    REFERENCES public.inventory_checks(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_s_number TEXT NOT NULL,
  signup_status TEXT NOT NULL DEFAULT 'signed_up'
    CHECK (signup_status IN ('signed_up', 'withdrawn')),
  attendance_status TEXT NOT NULL DEFAULT 'expected'
    CHECK (attendance_status IN ('expected', 'present', 'absent', 'excused')),
  attendance_reason TEXT NULL,
  marked_by TEXT NULL,
  marked_at TIMESTAMPTZ NULL,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_check_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_check_signups_check
  ON public.inventory_check_signups(inventory_check_id);

CREATE INDEX IF NOT EXISTS idx_inventory_check_signups_employee
  ON public.inventory_check_signups(employee_id);

CREATE TABLE IF NOT EXISTS public.inventory_check_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_check_id UUID NOT NULL
    REFERENCES public.inventory_checks(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_s_number TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('add', 'drop')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_check_requests_status
  ON public.inventory_check_change_requests(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_check_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_check_id UUID NOT NULL REFERENCES public.inventory_checks(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NULL,
  record_id TEXT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_check_audit_log_check_time
  ON public.inventory_check_audit_log(inventory_check_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.inventory_checks_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_checks_set_updated_at ON public.inventory_checks;
CREATE TRIGGER trg_inventory_checks_set_updated_at
BEFORE UPDATE ON public.inventory_checks
FOR EACH ROW EXECUTE FUNCTION public.inventory_checks_set_updated_at();

CREATE OR REPLACE FUNCTION public.inventory_check_signups_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_check_signups_set_updated_at ON public.inventory_check_signups;
CREATE TRIGGER trg_inventory_check_signups_set_updated_at
BEFORE UPDATE ON public.inventory_check_signups
FOR EACH ROW EXECUTE FUNCTION public.inventory_check_signups_set_updated_at();

ALTER TABLE public.inventory_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_check_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_check_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_check_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_checks_all ON public.inventory_checks;
CREATE POLICY inventory_checks_all ON public.inventory_checks
FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS inventory_check_signups_all ON public.inventory_check_signups;
CREATE POLICY inventory_check_signups_all ON public.inventory_check_signups
FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS inventory_check_change_requests_all ON public.inventory_check_change_requests;
CREATE POLICY inventory_check_change_requests_all ON public.inventory_check_change_requests
FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS inventory_check_audit_log_all ON public.inventory_check_audit_log;
CREATE POLICY inventory_check_audit_log_all ON public.inventory_check_audit_log
FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

INSERT INTO public.access_permissions (permission_key, department, resource, action, scope, label, is_active)
VALUES
  ('inventory.attendance:view:all','inventory','attendance','view','all','Inventory Attendance View',TRUE),
  ('inventory.attendance:edit:all','inventory','attendance','edit','all','Inventory Attendance Edit',TRUE),
  ('inventory.attendance:override:all','inventory','attendance','override','all','Inventory Attendance Override',TRUE),
  ('inventory.attendance:requests:approve:all','inventory','attendance.requests','approve','all','Inventory Attendance Request Approve',TRUE),
  ('employee.inventory_checks:view:own','employee','inventory_checks','view','own','Employee Inventory Checks View',TRUE),
  ('employee.inventory_checks:signup:own','employee','inventory_checks','signup','own','Employee Inventory Checks Signup',TRUE),
  ('employee.inventory_checks:request_change:own','employee','inventory_checks','request_change','own','Employee Inventory Checks Change Request',TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET
  department = EXCLUDED.department,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  label = EXCLUDED.label,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO public.access_role_permissions (role_key, permission_key) VALUES
  ('inventory_admin','inventory.attendance:view:all'),
  ('inventory_admin','inventory.attendance:edit:all'),
  ('inventory_admin','inventory.attendance:override:all'),
  ('inventory_admin','inventory.attendance:requests:approve:all'),
  ('employee_self_service','employee.inventory_checks:view:own'),
  ('employee_self_service','employee.inventory_checks:signup:own'),
  ('employee_self_service','employee.inventory_checks:request_change:own')
ON CONFLICT (role_key, permission_key) DO NOTHING;

COMMIT;
