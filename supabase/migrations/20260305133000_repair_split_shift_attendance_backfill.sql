BEGIN;

-- Force-rebuild split attendance tables from shift_attendance source-of-truth.
DELETE FROM public.morning_shift_attendance;
DELETE FROM public.off_period_shift_attendance;

INSERT INTO public.morning_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
WHERE sa.shift_period = 0
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

INSERT INTO public.off_period_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
LEFT JOIN public.employee_settings es
  ON es.employee_s_number = sa.employee_s_number
WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

COMMIT;
