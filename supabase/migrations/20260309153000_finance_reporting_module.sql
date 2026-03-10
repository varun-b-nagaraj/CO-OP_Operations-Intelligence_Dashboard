-- Finance reporting workflow tables, storage policies, and v1 open-access RLS.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.finance_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.finance_report_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_name TEXT NOT NULL CHECK (char_length(report_name) <= 200),
  school_year_label TEXT,
  source_filename TEXT NOT NULL,
  source_file_path TEXT,
  uploaded_by TEXT NOT NULL DEFAULT 'open_access',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'saved', 'exported', 'failed_validation')),
  report_period_start DATE,
  report_period_end DATE,
  total_row_count INTEGER NOT NULL DEFAULT 0 CHECK (total_row_count >= 0),
  total_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_fees NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_payout NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_report_headers_period_check CHECK (
    report_period_start IS NULL OR report_period_end IS NULL OR report_period_start <= report_period_end
  )
);

CREATE INDEX IF NOT EXISTS idx_finance_report_headers_uploaded_at
  ON public.finance_report_headers(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_report_headers_status
  ON public.finance_report_headers(status);
CREATE INDEX IF NOT EXISTS idx_finance_report_headers_school_year
  ON public.finance_report_headers(school_year_label);
CREATE INDEX IF NOT EXISTS idx_finance_report_headers_uploaded_by
  ON public.finance_report_headers(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_finance_report_headers_period
  ON public.finance_report_headers(report_period_start, report_period_end);

DROP TRIGGER IF EXISTS finance_report_headers_set_updated_at ON public.finance_report_headers;
CREATE TRIGGER finance_report_headers_set_updated_at
BEFORE UPDATE ON public.finance_report_headers
FOR EACH ROW
EXECUTE FUNCTION public.finance_set_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_report_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.finance_report_headers(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL CHECK (row_index >= 1),
  business_sales_date DATE NOT NULL,
  payout_date DATE,
  collected_amount NUMERIC(14,2) NOT NULL,
  fee_amount NUMERIC(14,2) NOT NULL,
  payout_amount NUMERIC(14,2) NOT NULL,
  taxed_sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  non_taxed_sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  lightspeed_fee_debit NUMERIC(14,2) NOT NULL,
  cash_account_debit NUMERIC(14,2) NOT NULL,
  ach_bank_date DATE,
  gcr_gni TEXT,
  raw_source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_report_rows_unique_row_per_report UNIQUE (report_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_finance_report_rows_report_id
  ON public.finance_report_rows(report_id, row_index);
CREATE INDEX IF NOT EXISTS idx_finance_report_rows_sales_date
  ON public.finance_report_rows(business_sales_date);
CREATE INDEX IF NOT EXISTS idx_finance_report_rows_payout_date
  ON public.finance_report_rows(payout_date);

CREATE TABLE IF NOT EXISTS public.finance_report_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.finance_report_headers(id) ON DELETE CASCADE,
  row_index INTEGER CHECK (row_index IS NULL OR row_index >= 1),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  field_name TEXT,
  raw_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_report_issues_report_id
  ON public.finance_report_issues(report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_report_issues_severity
  ON public.finance_report_issues(severity);

CREATE TABLE IF NOT EXISTS public.finance_report_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS finance_report_config_set_updated_at ON public.finance_report_config;
CREATE TRIGGER finance_report_config_set_updated_at
BEFORE UPDATE ON public.finance_report_config
FOR EACH ROW
EXECUTE FUNCTION public.finance_set_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_report_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.finance_report_headers(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('csv_uploaded', 'report_created', 'report_regenerated', 'report_exported', 'report_deleted', 'report_archived')),
  actor TEXT NOT NULL DEFAULT 'open_access',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_report_activity_log_report_id
  ON public.finance_report_activity_log(report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_report_activity_log_action
  ON public.finance_report_activity_log(action, created_at DESC);

INSERT INTO public.finance_report_config (config_key, config_value, description)
VALUES
  ('activityRevenueCodeTaxed', '"ACTIVITY_REVENUE_TAXED"'::jsonb, 'Credit account code used for taxed card sales.'),
  ('activityRevenueCodeNonTaxed', '"ACTIVITY_REVENUE_NON_TAXED"'::jsonb, 'Credit account code used for non-taxed card sales.'),
  ('salesTaxAccountCode', '"SALES_TAX_APPLIED"'::jsonb, 'Credit account code used for collected sales tax.'),
  ('lightspeedFeeDebitCode', '"LIGHTSPEED_FEE"'::jsonb, 'Debit account code used for processor fees.'),
  ('cashAccountDebitCode', '"CASH_ACCOUNT"'::jsonb, 'Debit account code used for payout cash account.'),
  ('defaultGcrGni', '"GCR"'::jsonb, 'Default posting mode when source CSV does not provide GCR/GNI.')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.finance_report_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_report_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_report_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_report_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_report_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_finance_report_headers ON public.finance_report_headers;
CREATE POLICY open_access_finance_report_headers
  ON public.finance_report_headers
  FOR ALL TO public
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS open_access_finance_report_rows ON public.finance_report_rows;
CREATE POLICY open_access_finance_report_rows
  ON public.finance_report_rows
  FOR ALL TO public
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS open_access_finance_report_issues ON public.finance_report_issues;
CREATE POLICY open_access_finance_report_issues
  ON public.finance_report_issues
  FOR ALL TO public
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS open_access_finance_report_config ON public.finance_report_config;
CREATE POLICY open_access_finance_report_config
  ON public.finance_report_config
  FOR ALL TO public
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS open_access_finance_report_activity_log ON public.finance_report_activity_log;
CREATE POLICY open_access_finance_report_activity_log
  ON public.finance_report_activity_log
  FOR ALL TO public
  USING (TRUE)
  WITH CHECK (TRUE);

INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-files', 'finance-files', TRUE)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS finance_files_public_read ON storage.objects;
CREATE POLICY finance_files_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'finance-files');

DROP POLICY IF EXISTS finance_files_public_write ON storage.objects;
CREATE POLICY finance_files_public_write
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'finance-files');

DROP POLICY IF EXISTS finance_files_public_update ON storage.objects;
CREATE POLICY finance_files_public_update
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'finance-files')
WITH CHECK (bucket_id = 'finance-files');

DROP POLICY IF EXISTS finance_files_public_delete ON storage.objects;
CREATE POLICY finance_files_public_delete
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'finance-files');

COMMIT;
