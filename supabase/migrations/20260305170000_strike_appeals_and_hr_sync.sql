BEGIN;

CREATE TABLE IF NOT EXISTS public.strike_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strike_id UUID NOT NULL REFERENCES public.strikes(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_s_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strike_appeals_employee_status
  ON public.strike_appeals(employee_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_strike_appeals_strike
  ON public.strike_appeals(strike_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strike_appeals_one_pending_per_strike_employee
  ON public.strike_appeals(strike_id, employee_id)
  WHERE status = 'pending';

ALTER TABLE public.strike_appeals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS open_access_strike_appeals ON public.strike_appeals;
CREATE POLICY open_access_strike_appeals
  ON public.strike_appeals FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.hr_strike_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strike_id UUID NOT NULL REFERENCES public.hr_strikes(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_s_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_strike_appeals_employee_status
  ON public.hr_strike_appeals(employee_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_strike_appeals_strike
  ON public.hr_strike_appeals(strike_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_strike_appeals_one_pending_per_strike_employee
  ON public.hr_strike_appeals(strike_id, employee_id)
  WHERE status = 'pending';

ALTER TABLE public.hr_strike_appeals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_strike_appeals_all ON public.hr_strike_appeals;
CREATE POLICY hr_strike_appeals_all
  ON public.hr_strike_appeals FOR ALL
  USING (true)
  WITH CHECK (true);

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

DROP TRIGGER IF EXISTS trg_sync_strike_appeals_to_hr_strike_appeals ON public.strike_appeals;
CREATE TRIGGER trg_sync_strike_appeals_to_hr_strike_appeals
AFTER INSERT OR UPDATE OR DELETE ON public.strike_appeals
FOR EACH ROW
EXECUTE FUNCTION public.hr_sync_pair('public.strike_appeals', 'public.hr_strike_appeals', 'id');

DROP TRIGGER IF EXISTS trg_sync_hr_strike_appeals_to_strike_appeals ON public.hr_strike_appeals;
CREATE TRIGGER trg_sync_hr_strike_appeals_to_strike_appeals
AFTER INSERT OR UPDATE OR DELETE ON public.hr_strike_appeals
FOR EACH ROW
EXECUTE FUNCTION public.hr_sync_pair('public.hr_strike_appeals', 'public.strike_appeals', 'id');

INSERT INTO public.hr_strike_appeals
SELECT *
FROM public.strike_appeals
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.strike_appeals
SELECT *
FROM public.hr_strike_appeals
ON CONFLICT (id) DO NOTHING;

COMMIT;
