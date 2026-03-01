BEGIN;

ALTER TABLE public.shift_change_requests
  ADD COLUMN IF NOT EXISTS request_source TEXT;

UPDATE public.shift_change_requests
SET request_source = CASE
  WHEN reason ILIKE '%Saved schedule edits%'
    OR reason ILIKE '%Assigned from schedule tab%'
    OR reason ILIKE '%Self-volunteered for shift%'
    OR reason ILIKE '%Self-removed from volunteered shift%'
    THEN 'manager_schedule'
  ELSE 'employee_form'
END
WHERE request_source IS NULL;

ALTER TABLE public.shift_change_requests
  ALTER COLUMN request_source SET DEFAULT 'employee_form';

ALTER TABLE public.shift_change_requests
  ALTER COLUMN request_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_change_requests_request_source_check'
  ) THEN
    ALTER TABLE public.shift_change_requests
      ADD CONSTRAINT shift_change_requests_request_source_check
      CHECK (request_source IN ('employee_form', 'manager_schedule', 'system'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_shift_change_request_source
  ON public.shift_change_requests(request_source, requested_at DESC);

COMMIT;
