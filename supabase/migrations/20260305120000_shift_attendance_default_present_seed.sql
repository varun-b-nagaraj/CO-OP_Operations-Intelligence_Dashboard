BEGIN;

-- Seeded schedule rows should default to present (auto-true) until manually overridden.
UPDATE public.shift_attendance
SET
  status = 'present',
  raw_status = COALESCE(raw_status, 'present')
WHERE
  status = 'expected'
  AND marked_by IS NULL
  AND source IN ('scheduler', 'shift_exchange');

COMMIT;
