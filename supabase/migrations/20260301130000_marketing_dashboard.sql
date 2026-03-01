BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'completed', 'cancelled')),
  category TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location TEXT,
  description TEXT,
  goals TEXT,
  target_audience TEXT,
  budget_planned NUMERIC(12,2) CHECK (budget_planned IS NULL OR budget_planned >= 0),
  budget_actual NUMERIC(12,2) CHECK (budget_actual IS NULL OR budget_actual >= 0),
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover_asset_id UUID,
  outcome_summary TEXT,
  what_worked TEXT,
  what_didnt TEXT,
  recommendations TEXT,
  estimated_interactions INTEGER CHECK (estimated_interactions IS NULL OR estimated_interactions >= 0),
  units_sold INTEGER CHECK (units_sold IS NULL OR units_sold >= 0),
  cost_roi_notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_marketing_events_starts_at ON public.marketing_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_status ON public.marketing_events(status);
CREATE INDEX IF NOT EXISTS idx_marketing_events_category ON public.marketing_events(category);

CREATE TABLE IF NOT EXISTS public.external_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization TEXT NOT NULL CHECK (btrim(organization) <> ''),
  person_name TEXT NOT NULL CHECK (btrim(person_name) <> ''),
  role_title TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_contacts_organization ON public.external_contacts(organization);
CREATE INDEX IF NOT EXISTS idx_external_contacts_person_name ON public.external_contacts(person_name);

CREATE TABLE IF NOT EXISTS public.event_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.marketing_events(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.external_contacts(id) ON DELETE CASCADE,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  coordinator_name TEXT,
  coordinator_role TEXT,
  coordinator_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (is_internal = TRUE AND btrim(coalesce(coordinator_name, '')) <> '')
    OR
    (is_internal = FALSE AND contact_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_contacts_unique_external
  ON public.event_contacts(event_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_contacts_event ON public.event_contacts(event_id);

CREATE TABLE IF NOT EXISTS public.event_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.marketing_events(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'marketing-files',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  asset_type TEXT NOT NULL DEFAULT 'other' CHECK (asset_type IN ('flyer', 'photo', 'mockup', 'schedule', 'other')),
  caption TEXT,
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_assets_event ON public.event_assets(event_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_assets_single_cover ON public.event_assets(event_id) WHERE is_cover = TRUE;

CREATE TABLE IF NOT EXISTS public.event_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.marketing_events(id) ON DELETE CASCADE,
  note TEXT NOT NULL CHECK (btrim(note) <> ''),
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_notes_event ON public.event_notes(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.coordination_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.marketing_events(id) ON DELETE CASCADE,
  contacted_party TEXT NOT NULL CHECK (btrim(contacted_party) <> ''),
  method TEXT NOT NULL DEFAULT 'email' CHECK (method IN ('email', 'call', 'in_person', 'text')),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  next_steps TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coordination_logs_event ON public.coordination_logs(event_id, created_at DESC);

ALTER TABLE public.marketing_events
  DROP CONSTRAINT IF EXISTS marketing_events_cover_asset_fkey;

ALTER TABLE public.marketing_events
  ADD CONSTRAINT marketing_events_cover_asset_fkey
  FOREIGN KEY (cover_asset_id)
  REFERENCES public.event_assets(id)
  ON DELETE SET NULL;

DROP TRIGGER IF EXISTS update_marketing_events_updated_at ON public.marketing_events;
CREATE TRIGGER update_marketing_events_updated_at
BEFORE UPDATE ON public.marketing_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_external_contacts_updated_at ON public.external_contacts;
CREATE TRIGGER update_external_contacts_updated_at
BEFORE UPDATE ON public.external_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-files', 'marketing-files', TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordination_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_events_all ON public.marketing_events;
CREATE POLICY marketing_events_all ON public.marketing_events FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS external_contacts_all ON public.external_contacts;
CREATE POLICY external_contacts_all ON public.external_contacts FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_contacts_all ON public.event_contacts;
CREATE POLICY event_contacts_all ON public.event_contacts FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_assets_all ON public.event_assets;
CREATE POLICY event_assets_all ON public.event_assets FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_notes_all ON public.event_notes;
CREATE POLICY event_notes_all ON public.event_notes FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS coordination_logs_all ON public.coordination_logs;
CREATE POLICY coordination_logs_all ON public.coordination_logs FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS marketing_files_public_read ON storage.objects;
CREATE POLICY marketing_files_public_read
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'marketing-files');

DROP POLICY IF EXISTS marketing_files_public_write ON storage.objects;
CREATE POLICY marketing_files_public_write
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'marketing-files');

DROP POLICY IF EXISTS marketing_files_public_update ON storage.objects;
CREATE POLICY marketing_files_public_update
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'marketing-files')
WITH CHECK (bucket_id = 'marketing-files');

DROP POLICY IF EXISTS marketing_files_public_delete ON storage.objects;
CREATE POLICY marketing_files_public_delete
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'marketing-files');

COMMIT;
