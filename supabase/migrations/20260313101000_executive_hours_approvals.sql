BEGIN;

CREATE TABLE IF NOT EXISTS public.executive_hour_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_s_number TEXT NOT NULL,
  hours_date DATE NOT NULL,
  project_name TEXT NOT NULL,
  commitment_name TEXT,
  description TEXT NOT NULL,
  submitted_hours NUMERIC(6,2) NOT NULL CHECK (submitted_hours > 0 AND submitted_hours <= 24),
  approved_hours NUMERIC(6,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT executive_hour_submissions_review_state_check CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status IN ('approved', 'denied') AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_executive_hour_submissions_employee_date
  ON public.executive_hour_submissions(employee_id, hours_date DESC);

CREATE INDEX IF NOT EXISTS idx_executive_hour_submissions_status_created
  ON public.executive_hour_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executive_hour_submissions_project
  ON public.executive_hour_submissions(project_name, hours_date DESC);

CREATE OR REPLACE FUNCTION public.executive_hour_submissions_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_executive_hour_submissions_set_updated_at ON public.executive_hour_submissions;
CREATE TRIGGER trg_executive_hour_submissions_set_updated_at
BEFORE UPDATE ON public.executive_hour_submissions
FOR EACH ROW
EXECUTE FUNCTION public.executive_hour_submissions_set_updated_at();

ALTER TABLE public.executive_hour_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS executive_hour_submissions_all ON public.executive_hour_submissions;
CREATE POLICY executive_hour_submissions_all
ON public.executive_hour_submissions
FOR ALL
USING (TRUE)
WITH CHECK (TRUE);

INSERT INTO public.access_permissions (
  permission_key, department, resource, action, scope, label, is_active
) VALUES
  ('executive.hours:view:all','executive','hours','view','all','Executive Hours View',TRUE),
  ('executive.hours:approve:all','executive','hours','approve','all','Executive Hours Approve',TRUE),
  ('employee.hours:submit:own','employee','hours','submit','own','Employee Hours Submit',TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET
  department = EXCLUDED.department,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  label = EXCLUDED.label,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO public.access_role_permissions (role_key, permission_key)
VALUES
  ('executive_manager','executive.hours:view:all'),
  ('executive_manager','executive.hours:approve:all'),
  ('employee_self_service','employee.hours:submit:own')
ON CONFLICT (role_key, permission_key) DO NOTHING;

COMMIT;
