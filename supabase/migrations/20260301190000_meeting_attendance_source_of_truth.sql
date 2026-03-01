BEGIN;

CREATE TABLE IF NOT EXISTS public.meeting_attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s_number TEXT NOT NULL,
  checkin_date DATE NOT NULL,
  api_status TEXT NOT NULL CHECK (api_status IN ('present', 'absent')),
  manual_status TEXT NULL CHECK (manual_status IN ('present', 'absent', 'excused')),
  effective_status TEXT NOT NULL CHECK (effective_status IN ('present', 'absent', 'excused')),
  source TEXT NOT NULL DEFAULT 'api_sync' CHECK (source IN ('api_sync', 'manual')),
  manual_reason TEXT NULL,
  last_api_synced_at TIMESTAMPTZ NULL,
  updated_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_attendance_records_unique_employee_date UNIQUE (s_number, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendance_records_date
  ON public.meeting_attendance_records(checkin_date);

CREATE INDEX IF NOT EXISTS idx_meeting_attendance_records_s_number_date
  ON public.meeting_attendance_records(s_number, checkin_date);

DROP TRIGGER IF EXISTS update_meeting_attendance_records_updated_at ON public.meeting_attendance_records;
CREATE TRIGGER update_meeting_attendance_records_updated_at
BEFORE UPDATE ON public.meeting_attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_meeting_attendance_records ON public.meeting_attendance_records;
CREATE POLICY open_access_meeting_attendance_records
  ON public.meeting_attendance_records FOR ALL
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
        AND tablename = 'meeting_attendance_records'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_attendance_records;
    END IF;
  END IF;
END $$;

COMMIT;
