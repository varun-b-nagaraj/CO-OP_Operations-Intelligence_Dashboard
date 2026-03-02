BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_event_categories_active_name
  ON public.marketing_event_categories(active, name);

DROP TRIGGER IF EXISTS update_marketing_event_categories_updated_at ON public.marketing_event_categories;
CREATE TRIGGER update_marketing_event_categories_updated_at
BEFORE UPDATE ON public.marketing_event_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.marketing_event_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_event_categories_all ON public.marketing_event_categories;
CREATE POLICY marketing_event_categories_all
  ON public.marketing_event_categories
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
        AND tablename = 'marketing_event_categories'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_event_categories;
    END IF;
  END IF;
END $$;

COMMIT;
