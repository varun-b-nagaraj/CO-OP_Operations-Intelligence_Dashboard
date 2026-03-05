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

COMMIT;
