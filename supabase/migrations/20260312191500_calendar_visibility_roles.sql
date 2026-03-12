BEGIN;

ALTER TABLE public.general_department_calendar_events
  ADD COLUMN IF NOT EXISTS view_for_everyone BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_role_keys TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.general_department_calendar_events
SET
  view_for_everyone = CASE
    WHEN priority = 'employee' THEN true
    ELSE false
  END,
  visible_role_keys = CASE
    WHEN priority = 'executive' THEN ARRAY['admin', 'executive_manager']::TEXT[]
    WHEN priority = 'director' THEN ARRAY['admin', 'executive_manager', 'manager', 'hr_lead']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END
WHERE
  (view_for_everyone = true AND COALESCE(array_length(visible_role_keys, 1), 0) = 0)
  OR priority IN ('director', 'executive');

CREATE INDEX IF NOT EXISTS idx_general_calendar_visible_role_keys
  ON public.general_department_calendar_events USING GIN (visible_role_keys);

COMMIT;
