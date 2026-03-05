BEGIN;

CREATE OR REPLACE FUNCTION public.hr_sync_pair()
RETURNS TRIGGER AS $$
DECLARE
  dst text;
  key_col text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  dst := TG_ARGV[1];
  key_col := TG_ARGV[2];

  IF TG_OP = 'DELETE' THEN
    EXECUTE format('DELETE FROM %s WHERE %I = $1.%I', dst, key_col, key_col) USING OLD;
    RETURN OLD;
  END IF;

  EXECUTE format('DELETE FROM %s WHERE %I = $1.%I', dst, key_col, key_col) USING NEW;
  EXECUTE format('INSERT INTO %s SELECT ($1).*', dst) USING NEW;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  rec record;
  policy_name text;
  trg_name text;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('strikes', 'hr_strikes', 'id'),
        ('shift_change_requests', 'hr_shift_change_requests', 'id'),
        ('points_ledger', 'hr_points_ledger', 'id'),
        ('audit_log', 'hr_audit_log', 'id'),
        ('user_roles', 'hr_user_roles', 'id'),
        ('attendance_overrides', 'hr_attendance_overrides', 'id'),
        ('schedules', 'hr_schedules', 'id'),
        ('employee_settings', 'hr_employee_settings', 'id'),
        ('shift_attendance', 'hr_shift_attendance', 'id'),
        ('morning_shift_attendance', 'hr_morning_shift_attendance', 'id'),
        ('off_period_shift_attendance', 'hr_off_period_shift_attendance', 'id'),
        ('meeting_attendance_records', 'hr_meeting_attendance_records', 'id'),
        ('employee_login_credentials', 'hr_employee_login_credentials', 'id')
    ) AS t(src, dst, key_col)
  LOOP
    IF to_regclass(format('public.%I', rec.src)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I (LIKE public.%I INCLUDING ALL)',
      rec.dst,
      rec.src
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.dst);

    policy_name := rec.dst || '_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, rec.dst);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
      policy_name,
      rec.dst
    );

    IF to_regclass(format('public.%I', rec.dst)) IS NULL THEN
      CONTINUE;
    END IF;

    trg_name := format('trg_sync_%s_to_%s', rec.src, rec.dst);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg_name, rec.src);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair(%L,%L,%L)',
      trg_name,
      rec.src,
      format('public.%I', rec.src),
      format('public.%I', rec.dst),
      rec.key_col
    );

    trg_name := format('trg_sync_%s_to_%s', rec.dst, rec.src);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg_name, rec.dst);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair(%L,%L,%L)',
      trg_name,
      rec.dst,
      format('public.%I', rec.dst),
      format('public.%I', rec.src),
      rec.key_col
    );

    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM public.%I ON CONFLICT (%I) DO NOTHING',
      rec.dst,
      rec.src,
      rec.key_col
    );
  END LOOP;
END $$;

-- Keep HR split-attendance mirrors automatically aligned with hr_shift_attendance source-of-truth.
CREATE OR REPLACE FUNCTION public.rebuild_hr_split_shift_attendance(p_employee_s_number TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF p_employee_s_number IS NULL THEN
    DELETE FROM public.hr_morning_shift_attendance;
    DELETE FROM public.hr_off_period_shift_attendance;

    INSERT INTO public.hr_morning_shift_attendance (
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
    FROM public.hr_shift_attendance sa
    WHERE sa.shift_period = 0
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;

    INSERT INTO public.hr_off_period_shift_attendance (
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
    FROM public.hr_shift_attendance sa
    LEFT JOIN public.hr_employee_settings es
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

  DELETE FROM public.hr_morning_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  DELETE FROM public.hr_off_period_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  INSERT INTO public.hr_morning_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.hr_shift_attendance sa
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

  INSERT INTO public.hr_off_period_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.hr_shift_attendance sa
  LEFT JOIN public.hr_employee_settings es
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

CREATE OR REPLACE FUNCTION public.sync_hr_split_shift_attendance_from_regular()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_hr_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_hr_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_hr_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_hr_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_hr_split_shift_attendance_from_employee_settings()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_hr_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_hr_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_hr_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_hr_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.hr_shift_attendance') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_sync_hr_split_shift_attendance_from_regular ON public.hr_shift_attendance;
    CREATE TRIGGER trg_sync_hr_split_shift_attendance_from_regular
    AFTER INSERT OR UPDATE OR DELETE ON public.hr_shift_attendance
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_hr_split_shift_attendance_from_regular();
  END IF;

  IF to_regclass('public.hr_employee_settings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_sync_hr_split_shift_attendance_from_employee_settings ON public.hr_employee_settings;
    CREATE TRIGGER trg_sync_hr_split_shift_attendance_from_employee_settings
    AFTER INSERT OR UPDATE OR DELETE ON public.hr_employee_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_hr_split_shift_attendance_from_employee_settings();
  END IF;

  IF to_regclass('public.hr_shift_attendance') IS NOT NULL
    AND to_regclass('public.hr_morning_shift_attendance') IS NOT NULL
    AND to_regclass('public.hr_off_period_shift_attendance') IS NOT NULL
  THEN
    PERFORM public.rebuild_hr_split_shift_attendance(NULL);
  END IF;
END $$;

COMMIT;
