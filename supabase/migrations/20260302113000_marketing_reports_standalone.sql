BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  category TEXT,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  perceived_impact TEXT,
  optional_cost NUMERIC(12,2) CHECK (optional_cost IS NULL OR optional_cost >= 0),
  linked_event_id UUID REFERENCES public.marketing_events(id) ON DELETE SET NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_reports_date ON public.marketing_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_reports_category ON public.marketing_reports(category);
CREATE INDEX IF NOT EXISTS idx_marketing_reports_linked_event ON public.marketing_reports(linked_event_id);

DROP TRIGGER IF EXISTS update_marketing_reports_updated_at ON public.marketing_reports;
CREATE TRIGGER update_marketing_reports_updated_at
BEFORE UPDATE ON public.marketing_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.marketing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_reports_all ON public.marketing_reports;
CREATE POLICY marketing_reports_all
  ON public.marketing_reports
  FOR ALL
  TO public
  USING (TRUE)
  WITH CHECK (TRUE);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'marketing_reports'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_reports;
    END IF;
  END IF;
END $$;

COMMIT;
