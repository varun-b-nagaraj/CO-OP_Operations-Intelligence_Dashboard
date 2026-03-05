BEGIN;

ALTER TABLE public.strikes
  ADD COLUMN IF NOT EXISTS record_type TEXT,
  ADD COLUMN IF NOT EXISTS warning_description TEXT;

UPDATE public.strikes
SET record_type = 'strike'
WHERE record_type IS NULL;

ALTER TABLE public.strikes
  ALTER COLUMN record_type SET DEFAULT 'strike',
  ALTER COLUMN record_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'strikes_record_type_check'
      AND conrelid = 'public.strikes'::regclass
  ) THEN
    ALTER TABLE public.strikes
      ADD CONSTRAINT strikes_record_type_check
      CHECK (record_type IN ('strike', 'warning'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'strikes_warning_description_required_check'
      AND conrelid = 'public.strikes'::regclass
  ) THEN
    ALTER TABLE public.strikes
      ADD CONSTRAINT strikes_warning_description_required_check
      CHECK (
        record_type <> 'warning'
        OR (warning_description IS NOT NULL AND btrim(warning_description) <> '')
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_strikes_record_type_active
  ON public.strikes(record_type, active, issued_at DESC);

COMMIT;
