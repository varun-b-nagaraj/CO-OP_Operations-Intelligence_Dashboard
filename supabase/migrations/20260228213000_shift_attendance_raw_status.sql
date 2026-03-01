BEGIN;

ALTER TABLE public.shift_attendance
  ADD COLUMN IF NOT EXISTS raw_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_attendance_raw_status_check'
  ) THEN
    ALTER TABLE public.shift_attendance
      ADD CONSTRAINT shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END;
$$;

-- Preserve historical raw misses for previously pardoned rows.
UPDATE public.shift_attendance
SET raw_status = 'absent'
WHERE status = 'excused' AND raw_status IS NULL;

COMMIT;
