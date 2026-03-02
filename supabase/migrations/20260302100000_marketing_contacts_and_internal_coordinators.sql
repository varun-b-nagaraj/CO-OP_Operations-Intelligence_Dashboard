BEGIN;

ALTER TABLE public.external_contacts
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS other_social TEXT;

CREATE TABLE IF NOT EXISTS public.internal_coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (btrim(full_name) <> ''),
  role_title TEXT,
  email TEXT,
  phone TEXT,
  instagram_handle TEXT,
  linkedin_url TEXT,
  other_social TEXT,
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_coordinators_full_name ON public.internal_coordinators(full_name);
CREATE INDEX IF NOT EXISTS idx_internal_coordinators_role_title ON public.internal_coordinators(role_title);
CREATE INDEX IF NOT EXISTS idx_internal_coordinators_email ON public.internal_coordinators(email);

DROP TRIGGER IF EXISTS update_internal_coordinators_updated_at ON public.internal_coordinators;
CREATE TRIGGER update_internal_coordinators_updated_at
BEFORE UPDATE ON public.internal_coordinators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_contacts
  ADD COLUMN IF NOT EXISTS internal_coordinator_id UUID REFERENCES public.internal_coordinators(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS idx_event_contacts_unique_internal_coordinator;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_contacts_unique_internal_coordinator
  ON public.event_contacts(event_id, internal_coordinator_id)
  WHERE internal_coordinator_id IS NOT NULL;

ALTER TABLE public.event_contacts
  DROP CONSTRAINT IF EXISTS event_contacts_check;

ALTER TABLE public.event_contacts
  DROP CONSTRAINT IF EXISTS event_contacts_internal_vs_external_check;

ALTER TABLE public.event_contacts
  ADD CONSTRAINT event_contacts_internal_vs_external_check CHECK (
    (
      is_internal = TRUE
      AND (
        internal_coordinator_id IS NOT NULL
        OR btrim(coalesce(coordinator_name, '')) <> ''
      )
    )
    OR
    (
      is_internal = FALSE
      AND contact_id IS NOT NULL
      AND internal_coordinator_id IS NULL
    )
  );

ALTER TABLE public.internal_coordinators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_coordinators_all ON public.internal_coordinators;
CREATE POLICY internal_coordinators_all ON public.internal_coordinators FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'internal_coordinators'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_coordinators;
    END IF;
  END IF;
END $$;

COMMIT;
