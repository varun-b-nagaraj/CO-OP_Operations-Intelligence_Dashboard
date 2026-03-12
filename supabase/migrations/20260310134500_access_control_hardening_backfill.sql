BEGIN;

-- Ensure supporting indexes exist.
CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_employee_id
  ON public.employee_role_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_role_template_id
  ON public.employee_role_assignments(role_template_id);
CREATE INDEX IF NOT EXISTS idx_employee_permission_overrides_employee_id
  ON public.employee_permission_overrides(employee_id);

-- Harden policies from public to authenticated.
ALTER TABLE IF EXISTS public.access_role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_role_templates_all ON public.access_role_templates;
CREATE POLICY access_role_templates_all
  ON public.access_role_templates
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS employee_role_assignments_all ON public.employee_role_assignments;
CREATE POLICY employee_role_assignments_all
  ON public.employee_role_assignments
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS employee_permission_overrides_all ON public.employee_permission_overrides;
CREATE POLICY employee_permission_overrides_all
  ON public.employee_permission_overrides
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS auth_sessions_all ON public.auth_sessions;
CREATE POLICY auth_sessions_all
  ON public.auth_sessions
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- Keep system role permissions aligned with current code usage.
UPDATE public.access_role_templates
SET permissions = CASE
  WHEN jsonb_typeof(permissions) = 'array' AND NOT (permissions ? 'cfa.exports')
    THEN permissions || to_jsonb('cfa.exports'::text)
  ELSE permissions
END,
updated_at = NOW()
WHERE role_key IN ('manager', 'HR_lead', 'exec');

-- Auto-assign employee role for newly inserted students.
CREATE OR REPLACE FUNCTION public.assign_default_employee_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.access_role_templates
  WHERE role_key = 'employee'
    AND is_active = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.employee_role_assignments (employee_id, role_template_id, is_primary, assigned_by)
  VALUES (NEW.id, v_role_id, TRUE, 'trigger_default')
  ON CONFLICT (employee_id, role_template_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_default_employee_role ON public.students;
CREATE TRIGGER trg_assign_default_employee_role
AFTER INSERT ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_employee_role();

-- Backfill any missing employee assignment rows again (safe/idempotent).
INSERT INTO public.employee_role_assignments (employee_id, role_template_id, is_primary, assigned_by)
SELECT
  s.id,
  art.id,
  TRUE,
  'hardening_backfill'
FROM public.students s
JOIN public.access_role_templates art ON art.role_key = 'employee' AND art.is_active = TRUE
LEFT JOIN public.employee_role_assignments era ON era.employee_id = s.id
WHERE era.employee_id IS NULL;

COMMIT;
