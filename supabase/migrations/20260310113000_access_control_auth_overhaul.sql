BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Role templates that support custom role creation without user_roles role enum constraints.
CREATE TABLE IF NOT EXISTS public.access_role_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.employee_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  role_template_id UUID NOT NULL REFERENCES public.access_role_templates(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, role_template_id)
);

CREATE TABLE IF NOT EXISTS public.employee_permission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, permission_key)
);

-- Session table for cookie-based auth.
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_employee_id
  ON public.auth_sessions(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON public.auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_employee_id
  ON public.employee_role_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_role_template_id
  ON public.employee_role_assignments(role_template_id);
CREATE INDEX IF NOT EXISTS idx_employee_permission_overrides_employee_id
  ON public.employee_permission_overrides(employee_id);

CREATE OR REPLACE FUNCTION public.access_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_role_templates_set_updated_at ON public.access_role_templates;
CREATE TRIGGER access_role_templates_set_updated_at
BEFORE UPDATE ON public.access_role_templates
FOR EACH ROW
EXECUTE FUNCTION public.access_set_updated_at();

ALTER TABLE public.access_role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

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

-- Remove username from all credential tables.
ALTER TABLE public.employee_login_credentials
  DROP COLUMN IF EXISTS username;

ALTER TABLE public.hr_employee_login_credentials
  DROP COLUMN IF EXISTS username;

ALTER TABLE public.hr_auth_credentials
  DROP COLUMN IF EXISTS username;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_login_credentials_username_key'
      AND conrelid = 'public.employee_login_credentials'::regclass
  ) THEN
    ALTER TABLE public.employee_login_credentials
      DROP CONSTRAINT employee_login_credentials_username_key;
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_employee_login_credentials_username;

-- Keep hr_auth_credentials aligned after username removal.
CREATE OR REPLACE FUNCTION public.sync_hr_auth_credentials_from_employee_login()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_uuid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.hr_auth_credentials WHERE employee_id = OLD.employee_id;
    RETURN OLD;
  END IF;

  SELECT employee_uuid INTO v_employee_uuid
  FROM public.students
  WHERE id = NEW.employee_id;

  INSERT INTO public.hr_auth_credentials (
    employee_id,
    employee_uuid,
    password_hash,
    updated_at,
    created_at
  ) VALUES (
    NEW.employee_id,
    v_employee_uuid,
    NEW.password_hash,
    now(),
    COALESCE(NEW.created_at, now())
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    employee_uuid = EXCLUDED.employee_uuid,
    password_hash = EXCLUDED.password_hash,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_hr_auth_credentials_from_employee_login ON public.employee_login_credentials;
CREATE TRIGGER trg_sync_hr_auth_credentials_from_employee_login
AFTER INSERT OR UPDATE OR DELETE ON public.employee_login_credentials
FOR EACH ROW
EXECUTE FUNCTION public.sync_hr_auth_credentials_from_employee_login();

-- Seed baseline system roles.
INSERT INTO public.access_role_templates (role_key, role_name, description, is_system, permissions)
VALUES
(
  'employee',
  'General Employee',
  'Default lowest-access role.',
  TRUE,
  '[
    "employee.calendar.view",
    "employee.schedule.view",
    "employee.accountability.view",
    "employee.requests.view",
    "employee.requests.edit"
  ]'::jsonb
),
(
  'manager',
  'Manager',
  'Department manager with operational edit access.',
  TRUE,
  '[
    "employee.calendar.view",
    "employee.schedule.view",
    "employee.accountability.view",
    "employee.requests.view",
    "employee.requests.edit",
    "hr.schedule.view",
    "hr.schedule.edit",
    "hr.attendance.view",
    "hr.requests.view",
    "hr.requests.edit",
    "hr.audit.view",
    "hr.calendar.view",
    "cfa.logs.read",
    "cfa.logs.write",
    "cfa.menu.manage",
    "cfa.day_type.override",
    "cfa.exports",
    "finance.upload.view",
    "finance.upload.edit",
    "finance.reports.view",
    "finance.calendar.view",
    "marketing.events.view",
    "marketing.events.edit",
    "marketing.contacts.view",
    "marketing.contacts.edit",
    "marketing.coordinators.view",
    "marketing.coordinators.edit",
    "marketing.reports.view",
    "marketing.reports.edit",
    "marketing.settings.view",
    "marketing.settings.edit",
    "marketing.calendar.view",
    "marketing.shared_calendar.view",
    "product.orders.view",
    "product.orders.edit",
    "product.prompts.view",
    "product.prompts.edit",
    "product.products.view",
    "product.products.edit",
    "product.vendors.view",
    "product.vendors.edit",
    "product.designs.view",
    "product.designs.edit",
    "product.wishlist.view",
    "product.wishlist.edit",
    "product.settings.view",
    "product.settings.edit",
    "product.calendar.view",
    "inventory.catalog.view",
    "inventory.catalog.edit",
    "inventory.sessions.view",
    "inventory.sessions.edit",
    "inventory.count_view.view",
    "inventory.count_view.edit",
    "inventory.finalize_upload.view",
    "inventory.finalize_upload.edit",
    "inventory.calendar.view"
  ]'::jsonb
),
(
  'HR_lead',
  'HR Lead',
  'Full HR/CFA + manager-level access.',
  TRUE,
  '[
    "employee.calendar.view",
    "employee.schedule.view",
    "employee.accountability.view",
    "employee.requests.view",
    "employee.requests.edit",
    "hr.schedule.view",
    "hr.schedule.edit",
    "hr.strikes.manage",
    "hr.attendance.view",
    "hr.attendance.override",
    "hr.requests.view",
    "hr.requests.edit",
    "hr.audit.view",
    "hr.settings.edit",
    "hr.calendar.view",
    "cfa.logs.read",
    "cfa.logs.write",
    "cfa.menu.manage",
    "cfa.day_type.override",
    "cfa.exports",
    "finance.upload.view",
    "finance.upload.edit",
    "finance.reports.view",
    "finance.calendar.view",
    "marketing.events.view",
    "marketing.events.edit",
    "marketing.contacts.view",
    "marketing.contacts.edit",
    "marketing.coordinators.view",
    "marketing.coordinators.edit",
    "marketing.reports.view",
    "marketing.reports.edit",
    "marketing.settings.view",
    "marketing.settings.edit",
    "marketing.calendar.view",
    "marketing.shared_calendar.view",
    "product.orders.view",
    "product.orders.edit",
    "product.prompts.view",
    "product.prompts.edit",
    "product.products.view",
    "product.products.edit",
    "product.vendors.view",
    "product.vendors.edit",
    "product.designs.view",
    "product.designs.edit",
    "product.wishlist.view",
    "product.wishlist.edit",
    "product.settings.view",
    "product.settings.edit",
    "product.calendar.view",
    "inventory.catalog.view",
    "inventory.catalog.edit",
    "inventory.sessions.view",
    "inventory.sessions.edit",
    "inventory.count_view.view",
    "inventory.count_view.edit",
    "inventory.finalize_upload.view",
    "inventory.finalize_upload.edit",
    "inventory.calendar.view"
  ]'::jsonb
),
(
  'exec',
  'Executive',
  'Full global access including executive control surfaces.',
  TRUE,
  '[
    "executive.ai_agent.view",
    "executive.ai_agent.edit",
    "executive.overview.view",
    "executive.department_feed.view",
    "executive.alerts.view",
    "executive.metrics.view",
    "executive.reports.view",
    "executive.calendar.view",
    "executive.access_control.view",
    "executive.access_control.edit",
    "employee.calendar.view",
    "employee.schedule.view",
    "employee.accountability.view",
    "employee.requests.view",
    "employee.requests.edit",
    "hr.schedule.view",
    "hr.schedule.edit",
    "hr.strikes.manage",
    "hr.attendance.view",
    "hr.attendance.override",
    "hr.requests.view",
    "hr.requests.edit",
    "hr.audit.view",
    "hr.settings.edit",
    "hr.calendar.view",
    "cfa.logs.read",
    "cfa.logs.write",
    "cfa.menu.manage",
    "cfa.day_type.override",
    "cfa.exports",
    "finance.upload.view",
    "finance.upload.edit",
    "finance.reports.view",
    "finance.reports.edit",
    "finance.calendar.view",
    "marketing.events.view",
    "marketing.events.edit",
    "marketing.contacts.view",
    "marketing.contacts.edit",
    "marketing.coordinators.view",
    "marketing.coordinators.edit",
    "marketing.reports.view",
    "marketing.reports.edit",
    "marketing.settings.view",
    "marketing.settings.edit",
    "marketing.calendar.view",
    "marketing.shared_calendar.view",
    "product.orders.view",
    "product.orders.edit",
    "product.prompts.view",
    "product.prompts.edit",
    "product.products.view",
    "product.products.edit",
    "product.vendors.view",
    "product.vendors.edit",
    "product.designs.view",
    "product.designs.edit",
    "product.wishlist.view",
    "product.wishlist.edit",
    "product.settings.view",
    "product.settings.edit",
    "product.calendar.view",
    "inventory.catalog.view",
    "inventory.catalog.edit",
    "inventory.sessions.view",
    "inventory.sessions.edit",
    "inventory.count_view.view",
    "inventory.count_view.edit",
    "inventory.finalize_upload.view",
    "inventory.finalize_upload.edit",
    "inventory.calendar.view"
  ]'::jsonb
)
ON CONFLICT (role_key) DO UPDATE
SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  permissions = EXCLUDED.permissions,
  is_active = TRUE;

-- Backfill each student with default employee role assignment when missing.
INSERT INTO public.employee_role_assignments (employee_id, role_template_id, is_primary, assigned_by)
SELECT
  s.id,
  art.id,
  TRUE,
  'migration_default'
FROM public.students s
JOIN public.access_role_templates art ON art.role_key = 'employee'
LEFT JOIN public.employee_role_assignments era ON era.employee_id = s.id
WHERE era.employee_id IS NULL;

-- Auto-assign default employee role for newly inserted students.
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

COMMIT;
