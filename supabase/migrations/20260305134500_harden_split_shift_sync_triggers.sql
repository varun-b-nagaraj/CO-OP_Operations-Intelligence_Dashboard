BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_split_shift_attendance(p_employee_s_number TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF p_employee_s_number IS NULL THEN
    DELETE FROM public.morning_shift_attendance;
    DELETE FROM public.off_period_shift_attendance;

    INSERT INTO public.morning_shift_attendance (
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
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
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
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

    RETURN;
  END IF;

  DELETE FROM public.morning_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  DELETE FROM public.off_period_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  INSERT INTO public.morning_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.shift_attendance sa
  WHERE sa.employee_s_number = p_employee_s_number
    AND sa.shift_period = 0
  ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
  DO UPDATE SET
    status = EXCLUDED.status,
    raw_status = EXCLUDED.raw_status,
    source = EXCLUDED.source,
    reason = EXCLUDED.reason,
    marked_by = EXCLUDED.marked_by,
    marked_at = EXCLUDED.marked_at;

  INSERT INTO public.off_period_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.shift_attendance sa
  LEFT JOIN public.employee_settings es
    ON es.employee_s_number = sa.employee_s_number
  WHERE sa.employee_s_number = p_employee_s_number
    AND sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
  ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
  DO UPDATE SET
    status = EXCLUDED.status,
    raw_status = EXCLUDED.raw_status,
    source = EXCLUDED.source,
    reason = EXCLUDED.reason,
    marked_by = EXCLUDED.marked_by,
    marked_at = EXCLUDED.marked_at;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_regular()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_regular ON public.shift_attendance;
CREATE TRIGGER trg_sync_split_shift_attendance_from_regular
AFTER INSERT OR UPDATE OR DELETE ON public.shift_attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_regular();

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_employee_settings()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_employee_settings ON public.employee_settings;
CREATE TRIGGER trg_sync_split_shift_attendance_from_employee_settings
AFTER INSERT OR UPDATE OR DELETE ON public.employee_settings
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_employee_settings();

-- Immediate repair/backfill for existing data.
SELECT public.rebuild_split_shift_attendance(NULL);

COMMIT;
