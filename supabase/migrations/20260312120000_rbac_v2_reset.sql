BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('public.access_role_templates') IS NOT NULL
    AND to_regclass('public.access_role_templates_legacy_202603') IS NULL THEN
    ALTER TABLE public.access_role_templates RENAME TO access_role_templates_legacy_202603;
  END IF;

  IF to_regclass('public.employee_permission_overrides') IS NOT NULL
    AND to_regclass('public.employee_permission_overrides_legacy_202603') IS NULL THEN
    ALTER TABLE public.employee_permission_overrides RENAME TO employee_permission_overrides_legacy_202603;
  END IF;

  IF to_regclass('public.employee_role_assignments') IS NOT NULL
    AND to_regclass('public.employee_role_assignments_legacy_202603') IS NULL THEN
    ALTER TABLE public.employee_role_assignments RENAME TO employee_role_assignments_legacy_202603;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.access_permissions (
  permission_key TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT,
  label TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.access_roles (
  role_key TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.access_role_permissions (
  role_key TEXT NOT NULL REFERENCES public.access_roles(role_key) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.access_permissions(permission_key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS public.employee_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL REFERENCES public.access_roles(role_key) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, role_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_role_primary_unique
  ON public.employee_role_assignments(employee_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_employee_id
  ON public.employee_role_assignments(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_role_assignments_role_key
  ON public.employee_role_assignments(role_key);

CREATE OR REPLACE FUNCTION public.access_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_permissions_set_updated_at ON public.access_permissions;
CREATE TRIGGER access_permissions_set_updated_at
BEFORE UPDATE ON public.access_permissions
FOR EACH ROW
EXECUTE FUNCTION public.access_set_updated_at();

DROP TRIGGER IF EXISTS access_roles_set_updated_at ON public.access_roles;
CREATE TRIGGER access_roles_set_updated_at
BEFORE UPDATE ON public.access_roles
FOR EACH ROW
EXECUTE FUNCTION public.access_set_updated_at();

DROP TRIGGER IF EXISTS employee_role_assignments_set_updated_at ON public.employee_role_assignments;
CREATE TRIGGER employee_role_assignments_set_updated_at
BEFORE UPDATE ON public.employee_role_assignments
FOR EACH ROW
EXECUTE FUNCTION public.access_set_updated_at();

INSERT INTO public.access_permissions (
  permission_key, department, resource, action, scope, label, is_active
) VALUES
  ('executive.ai:view:own','executive','ai','view','own','Executive AI Agent View',TRUE),
  ('executive.ai:manage:all','executive','ai','manage','all','Executive AI Agent Manage',TRUE),
  ('executive.overview:view:all','executive','overview','view','all','Executive Overview View',TRUE),
  ('executive.feed:view:all','executive','feed','view','all','Executive Feed View',TRUE),
  ('executive.alerts:view:all','executive','alerts','view','all','Executive Alerts View',TRUE),
  ('executive.metrics:view:all','executive','metrics','view','all','Executive Metrics View',TRUE),
  ('executive.reports:view:all','executive','reports','view','all','Executive Reports View',TRUE),
  ('executive.calendar:view:all','executive','calendar','view','all','Executive Calendar View',TRUE),
  ('executive.access:view:all','executive','access','view','all','Access Control View',TRUE),
  ('executive.access:manage:all','executive','access','manage','all','Access Control Manage',TRUE),
  ('executive.audit:view:all','executive','audit','view','all','Executive Audit View',TRUE),
  ('executive.audit:export:all','executive','audit','export','all','Executive Audit Export',TRUE),
  ('hr.schedule:view:own','hr','schedule','view','own','HR Schedule View Own',TRUE),
  ('hr.schedule:edit:all','hr','schedule','edit','all','HR Schedule Edit All',TRUE),
  ('hr.schedule:approve:all','hr','schedule','approve','all','HR Schedule Approve All',TRUE),
  ('hr.meeting_attendance:view:own','hr','meeting_attendance','view','own','Meeting Attendance View Own',TRUE),
  ('hr.meeting_attendance:override:all','hr','meeting_attendance','override','all','Meeting Attendance Override All',TRUE),
  ('hr.shift_attendance:view:own','hr','shift_attendance','view','own','Shift Attendance View Own',TRUE),
  ('hr.shift_attendance:override:all','hr','shift_attendance','override','all','Shift Attendance Override All',TRUE),
  ('hr.requests:submit:own','hr','requests','submit','own','HR Requests Submit Own',TRUE),
  ('hr.requests:approve:all','hr','requests','approve','all','HR Requests Approve All',TRUE),
  ('hr.employee_records:view:own','hr','employee_records','view','own','Employee Records View Own',TRUE),
  ('hr.employee_records:manage:all','hr','employee_records','manage','all','Employee Records Manage All',TRUE),
  ('hr.settings:view:own','hr','settings','view','own','HR Settings View Own',TRUE),
  ('hr.settings:manage:all','hr','settings','manage','all','HR Settings Manage All',TRUE),
  ('hr.strikes:view:own','hr','strikes','view','own','HR Strikes View Own',TRUE),
  ('hr.strikes:manage:all','hr','strikes','manage','all','HR Strikes Manage All',TRUE),
  ('hr.audit:view:all','hr','audit','view','all','HR Audit View',TRUE),
  ('hr.audit:export:all','hr','audit','export','all','HR Audit Export',TRUE),
  ('cfa.logs:view:all','cfa','logs','view','all','CFA Logs View',TRUE),
  ('cfa.logs:write:all','cfa','logs','write','all','CFA Logs Write',TRUE),
  ('cfa.history:view:all','cfa','history','view','all','CFA History View',TRUE),
  ('cfa.forecast:view:all','cfa','forecast','view','all','CFA Forecast View',TRUE),
  ('cfa.analytics:view:all','cfa','analytics','view','all','CFA Analysis View',TRUE),
  ('cfa.menu:view:all','cfa','menu','view','all','CFA Menu View',TRUE),
  ('cfa.menu:manage:all','cfa','menu','manage','all','CFA Menu Manage',TRUE),
  ('cfa.day_type:manage:all','cfa','day_type','manage','all','CFA Day Type Manage',TRUE),
  ('cfa.exports:export:all','cfa','exports','export','all','CFA Export',TRUE),
  ('finance.upload:view:own','finance','upload','view','own','Finance Upload View Own',TRUE),
  ('finance.upload:upload:all','finance','upload','upload','all','Finance Upload All',TRUE),
  ('finance.reports:view:all','finance','reports','view','all','Finance Reports View',TRUE),
  ('finance.reports:edit:all','finance','reports','edit','all','Finance Reports Edit',TRUE),
  ('finance.reports:export:all','finance','reports','export','all','Finance Reports Export',TRUE),
  ('finance.calendar:view:all','finance','calendar','view','all','Finance Calendar View',TRUE),
  ('marketing.events:view:own','marketing','events','view','own','Marketing Events View',TRUE),
  ('marketing.events:edit:all','marketing','events','edit','all','Marketing Events Edit',TRUE),
  ('marketing.events:publish:all','marketing','events','publish','all','Marketing Events Publish',TRUE),
  ('marketing.contacts:view:all','marketing','contacts','view','all','Marketing Contacts View',TRUE),
  ('marketing.contacts:edit:all','marketing','contacts','edit','all','Marketing Contacts Edit',TRUE),
  ('marketing.coordinators:view:all','marketing','coordinators','view','all','Marketing Coordinators View',TRUE),
  ('marketing.coordinators:edit:all','marketing','coordinators','edit','all','Marketing Coordinators Edit',TRUE),
  ('marketing.reports:view:all','marketing','reports','view','all','Marketing Reports View',TRUE),
  ('marketing.reports:edit:all','marketing','reports','edit','all','Marketing Reports Edit',TRUE),
  ('marketing.reports:export:all','marketing','reports','export','all','Marketing Reports Export',TRUE),
  ('marketing.calendars:view:all','marketing','calendars','view','all','Marketing Calendars View',TRUE),
  ('marketing.calendars:manage:all','marketing','calendars','manage','all','Marketing Calendars Manage',TRUE),
  ('marketing.settings:view:all','marketing','settings','view','all','Marketing Settings View',TRUE),
  ('marketing.settings:manage:all','marketing','settings','manage','all','Marketing Settings Manage',TRUE),
  ('product.orders:view:own','product','orders','view','own','Product Orders View',TRUE),
  ('product.orders:edit:all','product','orders','edit','all','Product Orders Edit',TRUE),
  ('product.orders:approve:all','product','orders','approve','all','Product Orders Approve',TRUE),
  ('product.orders:order:all','product','orders','order','all','Product Orders Place',TRUE),
  ('product.prompts:view:all','product','prompts','view','all','Product Prompts View',TRUE),
  ('product.prompts:edit:all','product','prompts','edit','all','Product Prompts Edit',TRUE),
  ('product.prompts:convert:all','product','prompts','convert','all','Product Prompts Convert',TRUE),
  ('product.products:view:all','product','products','view','all','Product Catalog View',TRUE),
  ('product.products:edit:all','product','products','edit','all','Product Catalog Edit',TRUE),
  ('product.vendors:view:all','product','vendors','view','all','Product Vendors View',TRUE),
  ('product.vendors:edit:all','product','vendors','edit','all','Product Vendors Edit',TRUE),
  ('product.designs:view:all','product','designs','view','all','Product Designs View',TRUE),
  ('product.designs:edit:all','product','designs','edit','all','Product Designs Edit',TRUE),
  ('product.wishlist:view:own','product','wishlist','view','own','Product Wishlist View',TRUE),
  ('product.wishlist:edit:all','product','wishlist','edit','all','Product Wishlist Edit',TRUE),
  ('product.wishlist:convert:all','product','wishlist','convert','all','Product Wishlist Convert',TRUE),
  ('product.settings:view:all','product','settings','view','all','Product Settings View',TRUE),
  ('product.settings:manage:all','product','settings','manage','all','Product Settings Manage',TRUE),
  ('product.calendar:view:all','product','calendar','view','all','Product Calendar View',TRUE),
  ('inventory.catalog:view:all','inventory','catalog','view','all','Inventory Catalog View',TRUE),
  ('inventory.catalog:edit:all','inventory','catalog','edit','all','Inventory Catalog Edit',TRUE),
  ('inventory.catalog:import:all','inventory','catalog','manage','all','Inventory Catalog Import',TRUE),
  ('inventory.sessions:join:assigned_location','inventory','sessions','join','assigned_location','Inventory Session Join',TRUE),
  ('inventory.sessions:create:all','inventory','sessions','create','all','Inventory Session Create',TRUE),
  ('inventory.sessions:edit:all','inventory','sessions','edit','all','Inventory Session Manage',TRUE),
  ('inventory.counts:view:own','inventory','counts','view','own','Inventory Count View',TRUE),
  ('inventory.counts:edit:all','inventory','counts','edit','all','Inventory Count Edit',TRUE),
  ('inventory.finalize_upload:view:own','inventory','finalize_upload','view','own','Inventory Finalize View',TRUE),
  ('inventory.finalize_upload:finalize:all','inventory','finalize_upload','finalize','all','Inventory Finalize',TRUE),
  ('inventory.finalize_upload:upload:all','inventory','finalize_upload','upload','all','Inventory Upload',TRUE),
  ('inventory.finalize_upload:lock:all','inventory','finalize_upload','lock','all','Inventory Lock Session',TRUE),
  ('inventory.calendar:view:all','inventory','calendar','view','all','Inventory Calendar View',TRUE),
  ('employee.calendar:view:own','employee','calendar','view','own','Employee Calendar View',TRUE),
  ('employee.schedule:view:own','employee','schedule','view','own','Employee Schedule View',TRUE),
  ('employee.schedule:submit:own','employee','schedule','submit','own','Employee Schedule Submit Requests',TRUE),
  ('employee.accountability:view:own','employee','accountability','view','own','Employee Accountability View',TRUE),
  ('employee.requests:submit:own','employee','requests','submit','own','Employee Requests Submit',TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET
  department = EXCLUDED.department,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  label = EXCLUDED.label,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO public.access_roles (
  role_key, role_name, description, is_system, is_active
) VALUES
  ('admin','Admin','Full system access.',TRUE,TRUE),
  ('executive_manager','Executive Manager','Executive dashboard, department overview, and access governance.',TRUE,TRUE),
  ('hr_manager','HR Manager','Manage HR operations and approvals.',TRUE,TRUE),
  ('hr_staff','HR Staff','HR operations with own-scope defaults and request handling.',TRUE,TRUE),
  ('inventory_admin','Inventory Admin','Full inventory management including session creation/finalize/upload.',TRUE,TRUE),
  ('inventory_counter','Inventory Counter','Join inventory sessions and submit counts; no session creation/finalization.',TRUE,TRUE),
  ('finance_manager','Finance Manager','Finance uploads and reporting.',TRUE,TRUE),
  ('marketing_manager','Marketing Manager','Marketing events and reporting.',TRUE,TRUE),
  ('product_manager','Product Manager','Manage product purchasing and catalog workflows.',TRUE,TRUE),
  ('employee_self_service','Employee Self Service','Default self-service employee access.',TRUE,TRUE),
  ('viewer','Viewer','Read-only cross-department visibility.',TRUE,TRUE)
ON CONFLICT (role_key) DO UPDATE
SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

DELETE FROM public.access_role_permissions;

INSERT INTO public.access_role_permissions (role_key, permission_key)
SELECT 'admin', permission_key FROM public.access_permissions;

INSERT INTO public.access_role_permissions (role_key, permission_key) VALUES
  ('executive_manager','executive.ai:view:own'),
  ('executive_manager','executive.ai:manage:all'),
  ('executive_manager','executive.overview:view:all'),
  ('executive_manager','executive.feed:view:all'),
  ('executive_manager','executive.alerts:view:all'),
  ('executive_manager','executive.metrics:view:all'),
  ('executive_manager','executive.reports:view:all'),
  ('executive_manager','executive.calendar:view:all'),
  ('executive_manager','executive.access:view:all'),
  ('executive_manager','executive.access:manage:all'),
  ('executive_manager','executive.audit:view:all'),
  ('executive_manager','executive.audit:export:all'),
  ('hr_manager','hr.schedule:view:own'),
  ('hr_manager','hr.schedule:edit:all'),
  ('hr_manager','hr.schedule:approve:all'),
  ('hr_manager','hr.meeting_attendance:view:own'),
  ('hr_manager','hr.meeting_attendance:override:all'),
  ('hr_manager','hr.shift_attendance:view:own'),
  ('hr_manager','hr.shift_attendance:override:all'),
  ('hr_manager','hr.requests:submit:own'),
  ('hr_manager','hr.requests:approve:all'),
  ('hr_manager','hr.employee_records:view:own'),
  ('hr_manager','hr.employee_records:manage:all'),
  ('hr_manager','hr.settings:view:own'),
  ('hr_manager','hr.settings:manage:all'),
  ('hr_manager','hr.strikes:view:own'),
  ('hr_manager','hr.strikes:manage:all'),
  ('hr_manager','hr.audit:view:all'),
  ('hr_manager','hr.audit:export:all'),
  ('hr_manager','employee.calendar:view:own'),
  ('hr_manager','employee.schedule:view:own'),
  ('hr_manager','employee.accountability:view:own'),
  ('hr_manager','employee.requests:submit:own'),
  ('hr_staff','hr.schedule:view:own'),
  ('hr_staff','hr.meeting_attendance:view:own'),
  ('hr_staff','hr.shift_attendance:view:own'),
  ('hr_staff','hr.requests:submit:own'),
  ('hr_staff','employee.calendar:view:own'),
  ('hr_staff','employee.schedule:view:own'),
  ('hr_staff','employee.accountability:view:own'),
  ('hr_staff','employee.requests:submit:own'),
  ('inventory_admin','inventory.catalog:view:all'),
  ('inventory_admin','inventory.catalog:edit:all'),
  ('inventory_admin','inventory.catalog:import:all'),
  ('inventory_admin','inventory.sessions:join:assigned_location'),
  ('inventory_admin','inventory.sessions:create:all'),
  ('inventory_admin','inventory.sessions:edit:all'),
  ('inventory_admin','inventory.counts:view:own'),
  ('inventory_admin','inventory.counts:edit:all'),
  ('inventory_admin','inventory.finalize_upload:view:own'),
  ('inventory_admin','inventory.finalize_upload:finalize:all'),
  ('inventory_admin','inventory.finalize_upload:upload:all'),
  ('inventory_admin','inventory.finalize_upload:lock:all'),
  ('inventory_admin','inventory.calendar:view:all'),
  ('inventory_counter','inventory.sessions:join:assigned_location'),
  ('inventory_counter','inventory.counts:view:own'),
  ('inventory_counter','inventory.catalog:view:all'),
  ('inventory_counter','inventory.finalize_upload:view:own'),
  ('finance_manager','finance.upload:view:own'),
  ('finance_manager','finance.upload:upload:all'),
  ('finance_manager','finance.reports:view:all'),
  ('finance_manager','finance.reports:edit:all'),
  ('finance_manager','finance.reports:export:all'),
  ('finance_manager','finance.calendar:view:all'),
  ('marketing_manager','marketing.events:view:own'),
  ('marketing_manager','marketing.events:edit:all'),
  ('marketing_manager','marketing.events:publish:all'),
  ('marketing_manager','marketing.contacts:view:all'),
  ('marketing_manager','marketing.contacts:edit:all'),
  ('marketing_manager','marketing.coordinators:view:all'),
  ('marketing_manager','marketing.coordinators:edit:all'),
  ('marketing_manager','marketing.reports:view:all'),
  ('marketing_manager','marketing.reports:edit:all'),
  ('marketing_manager','marketing.reports:export:all'),
  ('marketing_manager','marketing.calendars:view:all'),
  ('marketing_manager','marketing.calendars:manage:all'),
  ('marketing_manager','marketing.settings:view:all'),
  ('marketing_manager','marketing.settings:manage:all'),
  ('product_manager','product.orders:view:own'),
  ('product_manager','product.orders:edit:all'),
  ('product_manager','product.orders:approve:all'),
  ('product_manager','product.orders:order:all'),
  ('product_manager','product.prompts:view:all'),
  ('product_manager','product.prompts:edit:all'),
  ('product_manager','product.prompts:convert:all'),
  ('product_manager','product.products:view:all'),
  ('product_manager','product.products:edit:all'),
  ('product_manager','product.vendors:view:all'),
  ('product_manager','product.vendors:edit:all'),
  ('product_manager','product.designs:view:all'),
  ('product_manager','product.designs:edit:all'),
  ('product_manager','product.wishlist:view:own'),
  ('product_manager','product.wishlist:edit:all'),
  ('product_manager','product.wishlist:convert:all'),
  ('product_manager','product.settings:view:all'),
  ('product_manager','product.settings:manage:all'),
  ('product_manager','product.calendar:view:all'),
  ('employee_self_service','employee.calendar:view:own'),
  ('employee_self_service','employee.schedule:view:own'),
  ('employee_self_service','employee.schedule:submit:own'),
  ('employee_self_service','employee.accountability:view:own'),
  ('employee_self_service','employee.requests:submit:own'),
  ('employee_self_service','hr.schedule:view:own'),
  ('employee_self_service','hr.requests:submit:own'),
  ('viewer','executive.overview:view:all'),
  ('viewer','finance.reports:view:all'),
  ('viewer','marketing.events:view:own'),
  ('viewer','product.products:view:all'),
  ('viewer','inventory.catalog:view:all'),
  ('viewer','employee.calendar:view:own')
ON CONFLICT (role_key, permission_key) DO NOTHING;

TRUNCATE TABLE public.employee_role_assignments;

INSERT INTO public.employee_role_assignments (employee_id, role_key, is_primary)
SELECT s.id, 'employee_self_service', TRUE
FROM public.students s
ON CONFLICT (employee_id, role_key) DO UPDATE SET is_primary = EXCLUDED.is_primary;

DO $$
BEGIN
  IF to_regclass('public.employee_role_assignments_legacy_202603') IS NOT NULL
    AND to_regclass('public.access_role_templates_legacy_202603') IS NOT NULL THEN
    INSERT INTO public.employee_role_assignments (employee_id, role_key, is_primary)
    SELECT
      era.employee_id,
      CASE lower(art.role_key)
        WHEN 'exec' THEN 'admin'
        WHEN 'hr_lead' THEN 'hr_manager'
        WHEN 'manager' THEN 'executive_manager'
        WHEN 'employee' THEN 'employee_self_service'
        ELSE NULL
      END AS mapped_role_key,
      TRUE
    FROM public.employee_role_assignments_legacy_202603 era
    JOIN public.access_role_templates_legacy_202603 art ON art.id = era.role_template_id
    WHERE lower(art.role_key) IN ('exec', 'hr_lead', 'manager')
    ON CONFLICT (employee_id, role_key) DO UPDATE SET is_primary = EXCLUDED.is_primary;
  END IF;
END $$;

UPDATE public.employee_role_assignments default_row
SET is_primary = FALSE
WHERE default_row.role_key = 'employee_self_service'
  AND EXISTS (
    SELECT 1
    FROM public.employee_role_assignments elevated
    WHERE elevated.employee_id = default_row.employee_id
      AND elevated.role_key <> 'employee_self_service'
      AND elevated.is_primary = TRUE
  );

CREATE OR REPLACE FUNCTION public.assign_default_employee_role_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.employee_role_assignments (employee_id, role_key, is_primary)
  VALUES (NEW.id, 'employee_self_service', TRUE)
  ON CONFLICT (employee_id, role_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_default_employee_role ON public.students;
CREATE TRIGGER trg_assign_default_employee_role
AFTER INSERT ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_employee_role_v2();

ALTER TABLE public.access_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_permissions_all ON public.access_permissions;
CREATE POLICY access_permissions_all
  ON public.access_permissions
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS access_roles_all ON public.access_roles;
CREATE POLICY access_roles_all
  ON public.access_roles
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS access_role_permissions_all ON public.access_role_permissions;
CREATE POLICY access_role_permissions_all
  ON public.access_role_permissions
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS employee_role_assignments_all ON public.employee_role_assignments;
CREATE POLICY employee_role_assignments_all
  ON public.employee_role_assignments
  FOR ALL TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

COMMIT;
