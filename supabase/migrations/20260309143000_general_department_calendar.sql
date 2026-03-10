-- Shared department calendar data and marketing sync hooks.

CREATE TABLE IF NOT EXISTS public.general_department_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  details TEXT,
  entry_type TEXT NOT NULL DEFAULT 'event' CHECK (entry_type IN ('event', 'target', 'reminder')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'employee' CHECK (priority IN ('employee', 'department_manager', 'all_managers', 'exec')),
  source_department TEXT,
  source_marketing_event_id UUID UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_department_calendar_events_starts_at
  ON public.general_department_calendar_events(starts_at DESC);

DROP TRIGGER IF EXISTS update_general_department_calendar_events_updated_at ON public.general_department_calendar_events;
CREATE OR REPLACE FUNCTION public.general_department_calendar_events_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_general_department_calendar_events_updated_at
BEFORE UPDATE ON public.general_department_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.general_department_calendar_events_set_updated_at();

ALTER TABLE public.general_department_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS general_department_calendar_events_all ON public.general_department_calendar_events;
CREATE POLICY general_department_calendar_events_all
  ON public.general_department_calendar_events
  FOR ALL TO public USING (TRUE) WITH CHECK (TRUE);

ALTER TABLE public.marketing_events
  ADD COLUMN IF NOT EXISTS include_in_general_calendar BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS general_calendar_priority TEXT NOT NULL DEFAULT 'employee'
    CHECK (general_calendar_priority IN ('employee', 'department_manager', 'all_managers', 'exec'));

CREATE OR REPLACE FUNCTION public.sync_marketing_event_to_general_calendar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.general_department_calendar_events
    WHERE source_marketing_event_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.include_in_general_calendar IS NOT TRUE THEN
    DELETE FROM public.general_department_calendar_events
    WHERE source_marketing_event_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.general_department_calendar_events (
    title,
    details,
    entry_type,
    starts_at,
    ends_at,
    priority,
    source_department,
    source_marketing_event_id,
    created_by
  )
  VALUES (
    NEW.title,
    COALESCE(NEW.description, NEW.goals),
    'event',
    NEW.starts_at,
    NEW.ends_at,
    NEW.general_calendar_priority,
    'marketing',
    NEW.id,
    'marketing_sync'
  )
  ON CONFLICT (source_marketing_event_id) DO UPDATE SET
    title = EXCLUDED.title,
    details = EXCLUDED.details,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    priority = EXCLUDED.priority,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_marketing_event_to_general_calendar ON public.marketing_events;
CREATE TRIGGER sync_marketing_event_to_general_calendar
AFTER INSERT OR UPDATE OR DELETE ON public.marketing_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_marketing_event_to_general_calendar();

-- Backfill existing marketing events into the shared calendar.
INSERT INTO public.general_department_calendar_events (
  title,
  details,
  entry_type,
  starts_at,
  ends_at,
  priority,
  source_department,
  source_marketing_event_id,
  created_by
)
SELECT
  me.title,
  COALESCE(me.description, me.goals),
  'event',
  me.starts_at,
  me.ends_at,
  me.general_calendar_priority,
  'marketing',
  me.id,
  'marketing_sync'
FROM public.marketing_events me
WHERE me.include_in_general_calendar IS TRUE
ON CONFLICT (source_marketing_event_id) DO UPDATE SET
  title = EXCLUDED.title,
  details = EXCLUDED.details,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  priority = EXCLUDED.priority,
  updated_at = NOW();
