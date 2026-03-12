BEGIN;

ALTER TABLE public.access_roles
  ADD COLUMN IF NOT EXISTS role_priority INTEGER NOT NULL DEFAULT 100;

UPDATE public.access_roles
SET role_priority = CASE
  WHEN role_key IN ('admin', 'executive_manager') THEN 300
  WHEN role_key LIKE '%director%' OR role_key LIKE '%manager%' OR role_key IN ('hr_lead', 'manager') THEN 200
  ELSE 100
END;

CREATE INDEX IF NOT EXISTS idx_access_roles_role_priority
  ON public.access_roles(role_priority DESC);

UPDATE public.general_department_calendar_events
SET priority = CASE
  WHEN priority IN ('exec', 'executive') THEN 'executive'
  WHEN priority IN ('department_manager', 'all_managers', 'director') THEN 'director'
  ELSE 'employee'
END;

ALTER TABLE public.general_department_calendar_events
  DROP CONSTRAINT IF EXISTS general_department_calendar_events_priority_check;

ALTER TABLE public.general_department_calendar_events
  ADD CONSTRAINT general_department_calendar_events_priority_check
  CHECK (priority IN ('employee', 'director', 'executive'));

DO $$
BEGIN
  IF to_regclass('public.marketing_events') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $sql$
    UPDATE public.marketing_events
    SET general_calendar_priority = CASE
      WHEN general_calendar_priority IN ('exec', 'executive') THEN 'executive'
      WHEN general_calendar_priority IN ('department_manager', 'all_managers', 'director') THEN 'director'
      ELSE 'employee'
    END
  $sql$;

  EXECUTE $sql$
    ALTER TABLE public.marketing_events
    DROP CONSTRAINT IF EXISTS marketing_events_general_calendar_priority_check
  $sql$;

  EXECUTE $sql$
    ALTER TABLE public.marketing_events
    ADD CONSTRAINT marketing_events_general_calendar_priority_check
    CHECK (general_calendar_priority IN ('employee', 'director', 'executive'))
  $sql$;
END $$;

COMMIT;
