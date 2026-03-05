BEGIN;

CREATE TABLE IF NOT EXISTS public.morning_shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  raw_status TEXT,
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'morning_shift_attendance_raw_status_check'
      AND conrelid = 'public.morning_shift_attendance'::regclass
  ) THEN
    ALTER TABLE public.morning_shift_attendance
      ADD CONSTRAINT morning_shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_lookup
  ON public.morning_shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_date_period
  ON public.morning_shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_slot
  ON public.morning_shift_attendance(shift_date, shift_period, shift_slot_key);

CREATE TABLE IF NOT EXISTS public.off_period_shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  raw_status TEXT,
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'off_period_shift_attendance_raw_status_check'
      AND conrelid = 'public.off_period_shift_attendance'::regclass
  ) THEN
    ALTER TABLE public.off_period_shift_attendance
      ADD CONSTRAINT off_period_shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_lookup
  ON public.off_period_shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_date_period
  ON public.off_period_shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_slot
  ON public.off_period_shift_attendance(shift_date, shift_period, shift_slot_key);

ALTER TABLE public.morning_shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.off_period_shift_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_morning_shift_attendance ON public.morning_shift_attendance;
CREATE POLICY open_access_morning_shift_attendance
  ON public.morning_shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_off_period_shift_attendance ON public.off_period_shift_attendance;
CREATE POLICY open_access_off_period_shift_attendance
  ON public.off_period_shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

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
WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::integer[]))
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

COMMIT;
