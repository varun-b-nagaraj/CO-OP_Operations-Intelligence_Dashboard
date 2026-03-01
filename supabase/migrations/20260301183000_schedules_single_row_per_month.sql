BEGIN;

-- Keep only the newest generated schedule row per month before enforcing uniqueness.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY year, month
      ORDER BY generated_at DESC, id DESC
    ) AS row_rank
  FROM public.schedules
)
DELETE FROM public.schedules target
USING ranked
WHERE target.id = ranked.id
  AND ranked.row_rank > 1;

-- Canonical storage contract: one schedule row per month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_year_month_unique
  ON public.schedules(year, month);

COMMIT;
