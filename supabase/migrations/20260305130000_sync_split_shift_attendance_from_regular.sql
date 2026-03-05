BEGIN;

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_regular()
RETURNS TRIGGER AS $$
DECLARE
  effective_off_periods INTEGER[];
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.morning_shift_attendance
    WHERE shift_date = OLD.shift_date
      AND shift_period = OLD.shift_period
      AND shift_slot_key = OLD.shift_slot_key
      AND employee_s_number = OLD.employee_s_number;

    DELETE FROM public.off_period_shift_attendance
    WHERE shift_date = OLD.shift_date
      AND shift_period = OLD.shift_period
      AND shift_slot_key = OLD.shift_slot_key
      AND employee_s_number = OLD.employee_s_number;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.shift_period = 0 THEN
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
    ) VALUES (
      NEW.shift_date,
      NEW.shift_period,
      NEW.shift_slot_key,
      NEW.employee_s_number,
      NEW.status,
      NEW.raw_status,
      NEW.source,
      NEW.reason,
      NEW.marked_by,
      NEW.marked_at
    )
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;
  END IF;

  SELECT COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[])
  INTO effective_off_periods
  FROM public.employee_settings es
  WHERE es.employee_s_number = NEW.employee_s_number
  LIMIT 1;

  effective_off_periods := COALESCE(effective_off_periods, ARRAY[4,8]::INTEGER[]);

  IF NEW.shift_period = ANY(effective_off_periods) THEN
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
    ) VALUES (
      NEW.shift_date,
      NEW.shift_period,
      NEW.shift_slot_key,
      NEW.employee_s_number,
      NEW.status,
      NEW.raw_status,
      NEW.source,
      NEW.reason,
      NEW.marked_by,
      NEW.marked_at
    )
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_regular ON public.shift_attendance;
CREATE TRIGGER trg_sync_split_shift_attendance_from_regular
AFTER INSERT OR UPDATE OR DELETE ON public.shift_attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_regular();

-- Ensure current rows are fully synchronized after trigger creation.
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

DELETE FROM public.morning_shift_attendance msa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shift_attendance sa
  WHERE sa.shift_date = msa.shift_date
    AND sa.shift_period = msa.shift_period
    AND sa.shift_slot_key = msa.shift_slot_key
    AND sa.employee_s_number = msa.employee_s_number
    AND sa.shift_period = 0
);

DELETE FROM public.off_period_shift_attendance opsa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shift_attendance sa
  LEFT JOIN public.employee_settings es
    ON es.employee_s_number = sa.employee_s_number
  WHERE sa.shift_date = opsa.shift_date
    AND sa.shift_period = opsa.shift_period
    AND sa.shift_slot_key = opsa.shift_slot_key
    AND sa.employee_s_number = opsa.employee_s_number
    AND sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
);

COMMIT;
