-- Full bootstrap migration for new databases.
-- Includes baseline legacy tables, all existing module migrations,
-- and departmental HR-prefixed synchronization tables.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.students (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  s_number text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduleable boolean DEFAULT false,
  "Schedule" smallint
);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS employee_uuid uuid DEFAULT gen_random_uuid();

UPDATE public.students
SET employee_uuid = gen_random_uuid()
WHERE employee_uuid IS NULL;

ALTER TABLE public.students
  ALTER COLUMN employee_uuid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_employee_uuid_key'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_employee_uuid_key UNIQUE (employee_uuid);
  END IF;
END $$;

-- Legacy meeting attendance table (kept for compatibility with existing code paths).
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  s_number text NOT NULL,
  checkin_date date NOT NULL,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s_number, checkin_date)
);

-- Baseline inventory catalog table used by inventory migrations.
CREATE TABLE IF NOT EXISTS public."Inventory" (
  "System ID" bigint,
  "UPC" bigint,
  "EAN" text,
  "Custom SKU" text,
  "Manufact. SKU" text,
  "Item" text,
  "Vendor ID" text,
  "Qty." text,
  "Price" text,
  "Tax" text,
  "Brand" text,
  "Publish to eCom" text,
  "Season" text,
  "Department" text,
  "MSRP" text,
  "Tax Class" text,
  "Default Cost" double precision,
  "Vendor" text,
  "Category" text,
  "Subcategory 1" text,
  "Subcategory 2" text,
  "Subcategory 3" text,
  "Subcategory 4" text,
  "Subcategory 5" text,
  "Subcategory 6" text,
  "Subcategory 7" text,
  "Subcategory 8" text,
  "Subcategory 9" text
);

COMMIT;


-- ===== Included migration: supabase/migrations/20260228150000_hr_module.sql =====
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.strikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  reason TEXT NOT NULL,
  issued_by TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strikes_employee_active ON public.strikes(employee_id, active);

CREATE TABLE IF NOT EXISTS public.shift_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  from_employee_s_number TEXT NOT NULL,
  to_employee_s_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT shift_change_requests_from_to_distinct CHECK (from_employee_s_number <> to_employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_shift_change_status_date
  ON public.shift_change_requests(status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_change_one_approved_per_assignment
  ON public.shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_change_one_pending_per_assignment
  ON public.shift_change_requests(shift_date, shift_period, shift_slot_key, from_employee_s_number)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  point_type TEXT NOT NULL CHECK (point_type IN ('meeting', 'morning_shift', 'off_period_shift', 'project', 'manual')),
  points INTEGER NOT NULL,
  description TEXT,
  awarded_by TEXT,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_employee ON public.points_ledger(employee_id);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_timestamp ON public.audit_log(table_name, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'HR_lead', 'exec')),
  department TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s_number TEXT NOT NULL,
  checkin_date DATE NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('meeting', 'shift')),
  shift_period INTEGER CHECK (shift_period BETWEEN 0 AND 8),
  override_type TEXT NOT NULL CHECK (override_type IN ('excused', 'present_override')),
  reason TEXT NOT NULL,
  overridden_by TEXT,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_overrides_scope_period_consistency CHECK (
    (scope = 'meeting' AND shift_period IS NULL) OR
    (scope = 'shift' AND shift_period IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_lookup
  ON public.attendance_overrides(s_number, checkin_date);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_date
  ON public.attendance_overrides(checkin_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_overrides_meeting_unique
  ON public.attendance_overrides(s_number, checkin_date, scope)
  WHERE scope = 'meeting';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_overrides_shift_unique
  ON public.attendance_overrides(s_number, checkin_date, scope, shift_period)
  WHERE scope = 'shift';

CREATE TABLE IF NOT EXISTS public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  anchor_date DATE NOT NULL,
  anchor_day TEXT NOT NULL CHECK (anchor_day IN ('A', 'B')),
  seed INTEGER NOT NULL,
  schedule_data JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year, month, anchor_date, anchor_day, seed)
);

CREATE INDEX IF NOT EXISTS idx_schedules_lookup
  ON public.schedules(year, month, anchor_date, anchor_day, seed);

CREATE TABLE IF NOT EXISTS public.employee_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id),
  employee_s_number TEXT NOT NULL,
  off_periods INTEGER[] NOT NULL DEFAULT '{4,8}'::integer[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id),
  UNIQUE(employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_employee_settings_snumber
  ON public.employee_settings(employee_s_number);

CREATE TABLE IF NOT EXISTS public.shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

CREATE INDEX IF NOT EXISTS idx_shift_attendance_lookup
  ON public.shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_attendance_date_period
  ON public.shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_shift_attendance_slot
  ON public.shift_attendance(shift_date, shift_period, shift_slot_key);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_strikes_updated_at ON public.strikes;
CREATE TRIGGER update_strikes_updated_at
BEFORE UPDATE ON public.strikes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_roles_updated_at ON public.user_roles;
CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_schedules_updated_at ON public.schedules;
CREATE TRIGGER update_schedules_updated_at
BEFORE UPDATE ON public.schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_settings_updated_at ON public.employee_settings;
CREATE TRIGGER update_employee_settings_updated_at
BEFORE UPDATE ON public.employee_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_strikes ON public.strikes;
CREATE POLICY open_access_strikes
  ON public.strikes FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_shift_change_requests ON public.shift_change_requests;
CREATE POLICY open_access_shift_change_requests
  ON public.shift_change_requests FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_points_ledger ON public.points_ledger;
CREATE POLICY open_access_points_ledger
  ON public.points_ledger FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_audit_log ON public.audit_log;
CREATE POLICY open_access_audit_log
  ON public.audit_log FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_user_roles ON public.user_roles;
CREATE POLICY open_access_user_roles
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_attendance_overrides ON public.attendance_overrides;
CREATE POLICY open_access_attendance_overrides
  ON public.attendance_overrides FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_schedules ON public.schedules;
CREATE POLICY open_access_schedules
  ON public.schedules FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_employee_settings ON public.employee_settings;
CREATE POLICY open_access_employee_settings
  ON public.employee_settings FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_shift_attendance ON public.shift_attendance;
CREATE POLICY open_access_shift_attendance
  ON public.shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;


-- ===== Included migration: supabase/migrations/20260228180000_employee_login_credentials.sql =====
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.employee_login_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id),
  UNIQUE(username)
);

CREATE INDEX IF NOT EXISTS idx_employee_login_credentials_username
  ON public.employee_login_credentials(username);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_employee_login_credentials_updated_at ON public.employee_login_credentials;
CREATE TRIGGER update_employee_login_credentials_updated_at
BEFORE UPDATE ON public.employee_login_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.employee_login_credentials ENABLE ROW LEVEL SECURITY;

COMMIT;


-- ===== Included migration: supabase/migrations/20260228193000_cfa_module.sql =====
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cfa_items (
  item_id TEXT PRIMARY KEY CHECK (item_id ~ '^[a-z0-9_]+$'),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  buy_cost_cents INTEGER NOT NULL CHECK (buy_cost_cents >= 0),
  sell_price_cents INTEGER NOT NULL CHECK (sell_price_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cfa_daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date DATE NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('A', 'B')),
  period INTEGER NOT NULL CHECK (period IN (2, 6)),
  total_revenue_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_revenue_cents >= 0),
  total_cogs_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cogs_cents >= 0),
  total_profit_cents BIGINT NOT NULL DEFAULT 0,
  stockout_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (log_date, day_type),
  CONSTRAINT cfa_daily_logs_day_type_period_consistency CHECK (
    (day_type = 'A' AND period = 2) OR
    (day_type = 'B' AND period = 6)
  )
);

CREATE TABLE IF NOT EXISTS public.cfa_daily_log_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.cfa_daily_logs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.cfa_items(item_id),
  received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  leftover_qty INTEGER NOT NULL DEFAULT 0 CHECK (leftover_qty >= 0),
  missed_demand_qty INTEGER NOT NULL DEFAULT 0 CHECK (missed_demand_qty >= 0),
  sold_qty INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  true_demand_qty INTEGER NOT NULL DEFAULT 0 CHECK (true_demand_qty >= 0),
  sell_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sell_price_cents >= 0),
  buy_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (buy_cost_cents >= 0),
  revenue_cents BIGINT NOT NULL DEFAULT 0 CHECK (revenue_cents >= 0),
  cogs_cents BIGINT NOT NULL DEFAULT 0 CHECK (cogs_cents >= 0),
  profit_cents BIGINT NOT NULL DEFAULT 0,
  margin_pct NUMERIC(8, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (log_id, item_id),
  CONSTRAINT cfa_daily_log_lines_leftover_lte_received CHECK (leftover_qty <= received_qty),
  CONSTRAINT cfa_daily_log_lines_sold_formula CHECK (sold_qty = received_qty - leftover_qty),
  CONSTRAINT cfa_daily_log_lines_true_demand_formula CHECK (true_demand_qty = sold_qty + missed_demand_qty),
  CONSTRAINT cfa_daily_log_lines_revenue_formula CHECK (revenue_cents = sold_qty::bigint * sell_price_cents::bigint),
  CONSTRAINT cfa_daily_log_lines_cogs_formula CHECK (cogs_cents = sold_qty::bigint * buy_cost_cents::bigint),
  CONSTRAINT cfa_daily_log_lines_profit_formula CHECK (profit_cents = revenue_cents - cogs_cents),
  CONSTRAINT cfa_daily_log_lines_margin_rule CHECK (
    (revenue_cents = 0 AND margin_pct IS NULL) OR
    (revenue_cents > 0 AND margin_pct IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cfa_items_active ON public.cfa_items(active);
CREATE INDEX IF NOT EXISTS idx_cfa_daily_logs_date_type ON public.cfa_daily_logs(log_date, day_type);
CREATE INDEX IF NOT EXISTS idx_cfa_daily_log_lines_log_id ON public.cfa_daily_log_lines(log_id);
CREATE INDEX IF NOT EXISTS idx_cfa_daily_log_lines_item_id ON public.cfa_daily_log_lines(item_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cfa_apply_day_type_period()
RETURNS TRIGGER AS $$
BEGIN
  NEW.period = CASE NEW.day_type WHEN 'A' THEN 2 ELSE 6 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cfa_recompute_line_metrics()
RETURNS TRIGGER AS $$
DECLARE
  v_buy_cost INTEGER;
  v_sell_price INTEGER;
BEGIN
  SELECT buy_cost_cents, sell_price_cents
  INTO v_buy_cost, v_sell_price
  FROM public.cfa_items
  WHERE item_id = NEW.item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cfa_items row not found for item_id=%', NEW.item_id;
  END IF;

  NEW.received_qty = GREATEST(NEW.received_qty, 0);
  NEW.leftover_qty = GREATEST(NEW.leftover_qty, 0);
  NEW.missed_demand_qty = GREATEST(NEW.missed_demand_qty, 0);

  IF NEW.leftover_qty > NEW.received_qty THEN
    RAISE EXCEPTION 'leftover_qty (%) cannot exceed received_qty (%)', NEW.leftover_qty, NEW.received_qty;
  END IF;

  NEW.buy_cost_cents = v_buy_cost;
  NEW.sell_price_cents = v_sell_price;
  NEW.sold_qty = NEW.received_qty - NEW.leftover_qty;
  NEW.true_demand_qty = NEW.sold_qty + NEW.missed_demand_qty;
  NEW.revenue_cents = NEW.sold_qty::bigint * NEW.sell_price_cents::bigint;
  NEW.cogs_cents = NEW.sold_qty::bigint * NEW.buy_cost_cents::bigint;
  NEW.profit_cents = NEW.revenue_cents - NEW.cogs_cents;
  NEW.margin_pct = CASE
    WHEN NEW.revenue_cents > 0 THEN NEW.profit_cents::numeric / NEW.revenue_cents::numeric
    ELSE NULL
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cfa_recalculate_daily_totals(target_log_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.cfa_daily_logs
  SET
    total_revenue_cents = COALESCE(aggregates.total_revenue_cents, 0),
    total_cogs_cents = COALESCE(aggregates.total_cogs_cents, 0),
    total_profit_cents = COALESCE(aggregates.total_profit_cents, 0),
    stockout_flag = COALESCE(aggregates.stockout_flag, FALSE)
  FROM (
    SELECT
      log_id,
      SUM(revenue_cents)::bigint AS total_revenue_cents,
      SUM(cogs_cents)::bigint AS total_cogs_cents,
      SUM(profit_cents)::bigint AS total_profit_cents,
      BOOL_OR(missed_demand_qty > 0) AS stockout_flag
    FROM public.cfa_daily_log_lines
    WHERE log_id = target_log_id
    GROUP BY log_id
  ) aggregates
  WHERE public.cfa_daily_logs.id = target_log_id
    AND public.cfa_daily_logs.id = aggregates.log_id;

  IF NOT FOUND THEN
    UPDATE public.cfa_daily_logs
    SET
      total_revenue_cents = 0,
      total_cogs_cents = 0,
      total_profit_cents = 0,
      stockout_flag = FALSE
    WHERE id = target_log_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.cfa_sync_daily_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.cfa_recalculate_daily_totals(OLD.log_id);
    RETURN OLD;
  END IF;

  PERFORM public.cfa_recalculate_daily_totals(NEW.log_id);

  IF TG_OP = 'UPDATE' AND OLD.log_id <> NEW.log_id THEN
    PERFORM public.cfa_recalculate_daily_totals(OLD.log_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cfa_items_updated_at ON public.cfa_items;
CREATE TRIGGER update_cfa_items_updated_at
BEFORE UPDATE ON public.cfa_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_cfa_daily_logs_updated_at ON public.cfa_daily_logs;
CREATE TRIGGER update_cfa_daily_logs_updated_at
BEFORE UPDATE ON public.cfa_daily_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_cfa_daily_log_lines_updated_at ON public.cfa_daily_log_lines;
CREATE TRIGGER update_cfa_daily_log_lines_updated_at
BEFORE UPDATE ON public.cfa_daily_log_lines
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS cfa_set_period_before_write ON public.cfa_daily_logs;
CREATE TRIGGER cfa_set_period_before_write
BEFORE INSERT OR UPDATE OF day_type ON public.cfa_daily_logs
FOR EACH ROW
EXECUTE FUNCTION public.cfa_apply_day_type_period();

DROP TRIGGER IF EXISTS cfa_recompute_line_metrics_before_write ON public.cfa_daily_log_lines;
CREATE TRIGGER cfa_recompute_line_metrics_before_write
BEFORE INSERT OR UPDATE OF item_id, received_qty, leftover_qty, missed_demand_qty
ON public.cfa_daily_log_lines
FOR EACH ROW
EXECUTE FUNCTION public.cfa_recompute_line_metrics();

DROP TRIGGER IF EXISTS cfa_sync_totals_after_line_write ON public.cfa_daily_log_lines;
CREATE TRIGGER cfa_sync_totals_after_line_write
AFTER INSERT OR UPDATE OR DELETE ON public.cfa_daily_log_lines
FOR EACH ROW
EXECUTE FUNCTION public.cfa_sync_daily_totals();

INSERT INTO public.cfa_items (item_id, name, buy_cost_cents, sell_price_cents, active, updated_by)
VALUES
  ('strip_sliders', 'CFA Strip Sliders', 245, 400, TRUE, 'seed'),
  ('half_grilled_cool_wrap', 'CFA Half Grilled Cool Wrap', 349, 500, TRUE, 'seed')
ON CONFLICT (item_id) DO NOTHING;

ALTER TABLE public.cfa_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfa_daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfa_daily_log_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_cfa_items ON public.cfa_items;
CREATE POLICY open_access_cfa_items
  ON public.cfa_items FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_cfa_daily_logs ON public.cfa_daily_logs;
CREATE POLICY open_access_cfa_daily_logs
  ON public.cfa_daily_logs FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_cfa_daily_log_lines ON public.cfa_daily_log_lines;
CREATE POLICY open_access_cfa_daily_log_lines
  ON public.cfa_daily_log_lines FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;


-- ===== Included migration: supabase/migrations/20260228200000_shift_request_source.sql =====
BEGIN;

ALTER TABLE public.shift_change_requests
  ADD COLUMN IF NOT EXISTS request_source TEXT;

UPDATE public.shift_change_requests
SET request_source = CASE
  WHEN reason ILIKE '%Saved schedule edits%'
    OR reason ILIKE '%Assigned from schedule tab%'
    OR reason ILIKE '%Self-volunteered for shift%'
    OR reason ILIKE '%Self-removed from volunteered shift%'
    THEN 'manager_schedule'
  ELSE 'employee_form'
END
WHERE request_source IS NULL;

ALTER TABLE public.shift_change_requests
  ALTER COLUMN request_source SET DEFAULT 'employee_form';

ALTER TABLE public.shift_change_requests
  ALTER COLUMN request_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_change_requests_request_source_check'
  ) THEN
    ALTER TABLE public.shift_change_requests
      ADD CONSTRAINT shift_change_requests_request_source_check
      CHECK (request_source IN ('employee_form', 'manager_schedule', 'system'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_shift_change_request_source
  ON public.shift_change_requests(request_source, requested_at DESC);

COMMIT;


-- ===== Included migration: supabase/migrations/20260228213000_shift_attendance_raw_status.sql =====
BEGIN;

ALTER TABLE public.shift_attendance
  ADD COLUMN IF NOT EXISTS raw_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_attendance_raw_status_check'
  ) THEN
    ALTER TABLE public.shift_attendance
      ADD CONSTRAINT shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END;
$$;

-- Preserve historical raw misses for previously pardoned rows.
UPDATE public.shift_attendance
SET raw_status = 'absent'
WHERE status = 'excused' AND raw_status IS NULL;

COMMIT;


-- ===== Included migration: supabase/migrations/20260301010000_inventory_dashboard.sql =====
create extension if not exists pgcrypto;

-- String-safe helper columns and editability helpers on existing catalog table.
alter table public."Inventory"
  add column if not exists inventory_row_id bigint,
  add column if not exists system_id_text text,
  add column if not exists upc_text text,
  add column if not exists ean_text text,
  add column if not exists custom_sku_text text,
  add column if not exists manufact_sku_text text,
  add column if not exists inventory_deleted boolean not null default false,
  add column if not exists inventory_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_class
    where relkind = 'S'
      and relname = 'inventory_row_id_seq'
  ) then
    create sequence public.inventory_row_id_seq;
  end if;
end $$;

alter sequence public.inventory_row_id_seq owned by public."Inventory".inventory_row_id;
alter table public."Inventory" alter column inventory_row_id set default nextval('public.inventory_row_id_seq');

update public."Inventory"
set
  inventory_row_id = coalesce(inventory_row_id, nextval('public.inventory_row_id_seq')),
  system_id_text = coalesce(nullif(trim(system_id_text), ''), nullif(trim("System ID"::text), '')),
  upc_text = coalesce(nullif(trim(upc_text), ''), nullif(trim("UPC"::text), '')),
  ean_text = coalesce(nullif(trim(ean_text), ''), nullif(trim("EAN"), '')),
  custom_sku_text = coalesce(nullif(trim(custom_sku_text), ''), nullif(trim("Custom SKU"), '')),
  manufact_sku_text = coalesce(nullif(trim(manufact_sku_text), ''), nullif(trim("Manufact. SKU"), '')),
  inventory_updated_at = coalesce(inventory_updated_at, now());

create unique index if not exists inventory_row_id_uidx
  on public."Inventory" (inventory_row_id);

create index if not exists inventory_system_id_text_idx
  on public."Inventory" (system_id_text)
  where inventory_deleted = false;

create index if not exists inventory_upc_text_idx
  on public."Inventory" (upc_text)
  where inventory_deleted = false;

create index if not exists inventory_ean_text_idx
  on public."Inventory" (ean_text)
  where inventory_deleted = false;

create index if not exists inventory_custom_sku_text_idx
  on public."Inventory" (custom_sku_text)
  where inventory_deleted = false;

create index if not exists inventory_manufact_sku_text_idx
  on public."Inventory" (manufact_sku_text)
  where inventory_deleted = false;

create table if not exists public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null,
  status text not null default 'active' check (status in ('active', 'finalizing', 'locked')),
  host_id text not null,
  created_by text not null default 'open_access',
  baseline_session_id uuid null references public.inventory_sessions(id),
  last_sync_at timestamptz null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_sessions_status_idx on public.inventory_sessions(status);
create index if not exists inventory_sessions_created_at_idx on public.inventory_sessions(created_at desc);

create table if not exists public.inventory_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  participant_id text not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  event_count integer not null default 0,
  created_by text not null default 'open_access',
  unique(session_id, participant_id)
);

create index if not exists inventory_session_participants_session_idx
  on public.inventory_session_participants(session_id);

create table if not exists public.inventory_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  event_id text not null,
  actor_id text not null,
  system_id text not null,
  delta_qty integer not null,
  event_type text not null default 'SCAN',
  event_ts timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'open_access',
  unique(session_id, event_id)
);

create index if not exists inventory_session_events_session_system_idx
  on public.inventory_session_events(session_id, system_id);

create index if not exists inventory_session_events_session_actor_idx
  on public.inventory_session_events(session_id, actor_id);

create index if not exists inventory_session_events_ts_idx
  on public.inventory_session_events(event_ts);

create table if not exists public.inventory_session_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  snapshot_type text not null default 'sync',
  payload jsonb not null,
  created_by text not null default 'open_access',
  created_at timestamptz not null default now()
);

create index if not exists inventory_session_snapshots_session_idx
  on public.inventory_session_snapshots(session_id, created_at desc);

create table if not exists public.inventory_manual_overrides (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  system_id text not null,
  override_qty integer not null,
  reason text null,
  overridden_by text not null default 'open_access',
  created_at timestamptz not null default now(),
  unique(session_id, system_id)
);

create index if not exists inventory_manual_overrides_session_idx
  on public.inventory_manual_overrides(session_id);

create table if not exists public.inventory_session_final (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  system_id text not null,
  final_qty integer not null,
  finalized_by text not null default 'open_access',
  finalized_at timestamptz not null default now(),
  unique(session_id, system_id)
);

create index if not exists inventory_session_final_session_idx
  on public.inventory_session_final(session_id);

create table if not exists public.inventory_upload_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  triggered_by text not null default 'open_access',
  count_name text not null,
  shop_id text not null default '1',
  employee_id text not null default '1',
  reconcile boolean not null default true,
  omitted_items_zeroed_warning boolean not null default true,
  request_item_count integer not null default 0,
  request_payload_hash text not null,
  response_status integer not null,
  response_summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_upload_runs_session_idx
  on public.inventory_upload_runs(session_id, created_at desc);

create index if not exists inventory_upload_runs_hash_idx
  on public.inventory_upload_runs(request_payload_hash);

alter table public.inventory_sessions enable row level security;
alter table public.inventory_session_participants enable row level security;
alter table public.inventory_session_events enable row level security;
alter table public.inventory_session_snapshots enable row level security;
alter table public.inventory_manual_overrides enable row level security;
alter table public.inventory_session_final enable row level security;
alter table public.inventory_upload_runs enable row level security;

-- V1 open-access policies, keep created_by/host_id structure for future RBAC.
drop policy if exists inventory_sessions_all on public.inventory_sessions;
create policy inventory_sessions_all on public.inventory_sessions for all to public using (true) with check (true);

drop policy if exists inventory_session_participants_all on public.inventory_session_participants;
create policy inventory_session_participants_all on public.inventory_session_participants for all to public using (true) with check (true);

drop policy if exists inventory_session_events_all on public.inventory_session_events;
create policy inventory_session_events_all on public.inventory_session_events for all to public using (true) with check (true);

drop policy if exists inventory_session_snapshots_all on public.inventory_session_snapshots;
create policy inventory_session_snapshots_all on public.inventory_session_snapshots for all to public using (true) with check (true);

drop policy if exists inventory_manual_overrides_all on public.inventory_manual_overrides;
create policy inventory_manual_overrides_all on public.inventory_manual_overrides for all to public using (true) with check (true);

drop policy if exists inventory_session_final_all on public.inventory_session_final;
create policy inventory_session_final_all on public.inventory_session_final for all to public using (true) with check (true);

drop policy if exists inventory_upload_runs_all on public.inventory_upload_runs;
create policy inventory_upload_runs_all on public.inventory_upload_runs for all to public using (true) with check (true);


-- ===== Included migration: supabase/migrations/20260301020000_product_dashboard.sql =====
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.product_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  ordering_method TEXT NOT NULL DEFAULT 'online' CHECK (ordering_method IN ('online', 'in_store', 'phone', 'other')),
  default_link TEXT,
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  category TEXT,
  preferred_vendor_id UUID REFERENCES public.product_vendors(id),
  vendor_product_link TEXT,
  default_unit_cost NUMERIC(12,2) CHECK (default_unit_cost IS NULL OR default_unit_cost >= 0),
  retail_price NUMERIC(12,2) CHECK (retail_price IS NULL OR retail_price >= 0),
  barcode_upc TEXT,
  reorder_threshold INTEGER NOT NULL DEFAULT 5 CHECK (reorder_threshold >= 0),
  par_level INTEGER NOT NULL DEFAULT 0 CHECK (par_level >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_products_name ON public.product_products(name);
CREATE INDEX IF NOT EXISTS idx_product_products_vendor ON public.product_products(preferred_vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_products_active ON public.product_products(is_active);

CREATE TABLE IF NOT EXISTS public.product_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL DEFAULT 'product-files',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_inventory_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT,
  source TEXT NOT NULL DEFAULT 'manual_upload',
  notes TEXT,
  file_attachment_id UUID REFERENCES public.product_attachments(id)
);

CREATE TABLE IF NOT EXISTS public.product_inventory_snapshot_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_upload_id UUID NOT NULL REFERENCES public.product_inventory_uploads(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.product_products(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inventory_upload_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_inventory_snapshot_upload_id
  ON public.product_inventory_snapshot_lines(inventory_upload_id);

CREATE TABLE IF NOT EXISTS public.product_inventory_levels (
  product_id UUID PRIMARY KEY REFERENCES public.product_products(id) ON DELETE CASCADE,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  last_inventory_upload_id UUID REFERENCES public.product_inventory_uploads(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  requester_name TEXT NOT NULL,
  activity_account TEXT NOT NULL,
  account_number TEXT NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.product_vendors(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'submitted',
      'approved',
      'ordered',
      'partially_received',
      'received',
      'archived',
      'cancelled'
    )
  ),
  reason TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  date_placed DATE,
  requested_pickup_date DATE,
  asap BOOLEAN NOT NULL DEFAULT FALSE,
  expected_arrival_date DATE,
  notes TEXT,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_purchase_orders_status_vendor
  ON public.product_purchase_orders(status, vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_purchase_orders_date_placed
  ON public.product_purchase_orders(date_placed DESC);
CREATE INDEX IF NOT EXISTS idx_product_purchase_orders_priority
  ON public.product_purchase_orders(priority);

CREATE TABLE IF NOT EXISTS public.product_purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.product_purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.product_products(id),
  custom_item_name TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  product_link TEXT,
  notes TEXT,
  CHECK (product_id IS NOT NULL OR btrim(coalesce(custom_item_name, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_product_purchase_order_lines_order
  ON public.product_purchase_order_lines(purchase_order_id);

CREATE TABLE IF NOT EXISTS public.product_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.product_purchase_orders(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by TEXT,
  notes TEXT,
  attachment_id UUID REFERENCES public.product_attachments(id)
);

CREATE TABLE IF NOT EXISTS public.product_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id UUID NOT NULL REFERENCES public.product_purchase_order_lines(id) ON DELETE CASCADE,
  quantity_received INTEGER NOT NULL CHECK (quantity_received >= 0),
  is_damaged BOOLEAN NOT NULL DEFAULT FALSE,
  damage_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_receipt_lines_receipt
  ON public.product_receipt_lines(receipt_id);

CREATE TABLE IF NOT EXISTS public.product_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'review', 'approved', 'ready_to_order', 'archived')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  preferred_vendor_id UUID REFERENCES public.product_vendors(id),
  estimated_cost NUMERIC(12,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  front_attachment_id UUID REFERENCES public.product_attachments(id),
  back_attachment_id UUID REFERENCES public.product_attachments(id),
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL CHECK (btrim(item_name) <> ''),
  vendor_id UUID REFERENCES public.product_vendors(id),
  estimated_cost NUMERIC(12,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'researching', 'approved', 'converted', 'archived')),
  notes TEXT,
  converted_purchase_order_id UUID REFERENCES public.product_purchase_orders(id),
  converted_design_id UUID REFERENCES public.product_designs(id),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_order_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_upload_id UUID NOT NULL REFERENCES public.product_inventory_uploads(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.product_products(id) ON DELETE CASCADE,
  current_stock INTEGER NOT NULL CHECK (current_stock >= 0),
  on_order_qty INTEGER NOT NULL DEFAULT 0 CHECK (on_order_qty >= 0),
  suggested_qty INTEGER NOT NULL CHECK (suggested_qty >= 0),
  vendor_id UUID REFERENCES public.product_vendors(id),
  last_price NUMERIC(12,2) CHECK (last_price IS NULL OR last_price >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'converted')),
  converted_purchase_order_id UUID REFERENCES public.product_purchase_orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inventory_upload_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_order_prompts_status
  ON public.product_order_prompts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  actor TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_audit_log_entity
  ON public.product_audit_log(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.product_recalculate_order_total(target_order_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.product_purchase_orders p
  SET total_amount = COALESCE(lines.total, 0)
  FROM (
    SELECT purchase_order_id, SUM(line_total)::numeric(12,2) AS total
    FROM public.product_purchase_order_lines
    WHERE purchase_order_id = target_order_id
    GROUP BY purchase_order_id
  ) lines
  WHERE p.id = lines.purchase_order_id
    AND p.id = target_order_id;

  IF NOT FOUND THEN
    UPDATE public.product_purchase_orders
    SET total_amount = 0
    WHERE id = target_order_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.product_sync_order_total()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.product_recalculate_order_total(OLD.purchase_order_id);
    RETURN OLD;
  END IF;

  PERFORM public.product_recalculate_order_total(NEW.purchase_order_id);

  IF TG_OP = 'UPDATE' AND OLD.purchase_order_id <> NEW.purchase_order_id THEN
    PERFORM public.product_recalculate_order_total(OLD.purchase_order_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_product_settings_updated_at ON public.product_settings;
CREATE TRIGGER update_product_settings_updated_at
BEFORE UPDATE ON public.product_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_vendors_updated_at ON public.product_vendors;
CREATE TRIGGER update_product_vendors_updated_at
BEFORE UPDATE ON public.product_vendors
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_products_updated_at ON public.product_products;
CREATE TRIGGER update_product_products_updated_at
BEFORE UPDATE ON public.product_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_purchase_orders_updated_at ON public.product_purchase_orders;
CREATE TRIGGER update_product_purchase_orders_updated_at
BEFORE UPDATE ON public.product_purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_designs_updated_at ON public.product_designs;
CREATE TRIGGER update_product_designs_updated_at
BEFORE UPDATE ON public.product_designs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_wishlist_items_updated_at ON public.product_wishlist_items;
CREATE TRIGGER update_product_wishlist_items_updated_at
BEFORE UPDATE ON public.product_wishlist_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS product_sync_totals_after_line_write ON public.product_purchase_order_lines;
CREATE TRIGGER product_sync_totals_after_line_write
AFTER INSERT OR UPDATE OR DELETE ON public.product_purchase_order_lines
FOR EACH ROW
EXECUTE FUNCTION public.product_sync_order_total();

INSERT INTO public.product_settings (key, value, updated_by)
VALUES
  ('order.requester_default', 'Eric Chaverria', 'seed'),
  ('order.activity_account_default', 'Round Rock CO-OP (School Store)', 'seed'),
  ('order.account_number_default', '498-36-001-99-8468-6399', 'seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.product_vendors (name, ordering_method, notes, is_active, updated_by)
VALUES
  ('Coca-Cola', 'phone', '', TRUE, 'seed'),
  ('Sam''s Club', 'in_store', '', TRUE, 'seed'),
  ('HEB', 'in_store', '', TRUE, 'seed'),
  ('Amazon', 'online', '', TRUE, 'seed'),
  ('Hobby Lobby', 'in_store', '', TRUE, 'seed'),
  ('Home Depot', 'online', '', TRUE, 'seed'),
  ('Target', 'online', '', TRUE, 'seed'),
  ('Party City', 'online', '', TRUE, 'seed')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.product_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_snapshot_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_order_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_settings_all ON public.product_settings;
CREATE POLICY product_settings_all ON public.product_settings FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_vendors_all ON public.product_vendors;
CREATE POLICY product_vendors_all ON public.product_vendors FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_products_all ON public.product_products;
CREATE POLICY product_products_all ON public.product_products FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_attachments_all ON public.product_attachments;
CREATE POLICY product_attachments_all ON public.product_attachments FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_inventory_uploads_all ON public.product_inventory_uploads;
CREATE POLICY product_inventory_uploads_all ON public.product_inventory_uploads FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_inventory_snapshot_lines_all ON public.product_inventory_snapshot_lines;
CREATE POLICY product_inventory_snapshot_lines_all ON public.product_inventory_snapshot_lines FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_inventory_levels_all ON public.product_inventory_levels;
CREATE POLICY product_inventory_levels_all ON public.product_inventory_levels FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_purchase_orders_all ON public.product_purchase_orders;
CREATE POLICY product_purchase_orders_all ON public.product_purchase_orders FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_purchase_order_lines_all ON public.product_purchase_order_lines;
CREATE POLICY product_purchase_order_lines_all ON public.product_purchase_order_lines FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_receipts_all ON public.product_receipts;
CREATE POLICY product_receipts_all ON public.product_receipts FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_receipt_lines_all ON public.product_receipt_lines;
CREATE POLICY product_receipt_lines_all ON public.product_receipt_lines FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_designs_all ON public.product_designs;
CREATE POLICY product_designs_all ON public.product_designs FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_wishlist_items_all ON public.product_wishlist_items;
CREATE POLICY product_wishlist_items_all ON public.product_wishlist_items FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_order_prompts_all ON public.product_order_prompts;
CREATE POLICY product_order_prompts_all ON public.product_order_prompts FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_audit_log_all ON public.product_audit_log;
CREATE POLICY product_audit_log_all ON public.product_audit_log FOR ALL TO public USING (true) WITH CHECK (true);

COMMIT;


-- ===== Included migration: supabase/migrations/20260301030000_product_dashboard_adjustments.sql =====
BEGIN;

ALTER TABLE public.product_vendors
  DROP COLUMN IF EXISTS lead_time_days;

ALTER TABLE public.product_wishlist_items
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS converted_product_id UUID REFERENCES public.product_products(id);

CREATE INDEX IF NOT EXISTS idx_product_wishlist_converted_product
  ON public.product_wishlist_items(converted_product_id);

INSERT INTO public.product_settings (key, value, updated_by)
VALUES ('prompt.low_stock_cutoff', '2', 'migration')
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ===== Included migration: supabase/migrations/20260301040000_product_order_item_packaging_and_attachments.sql =====
BEGIN;

ALTER TABLE public.product_products
  ADD COLUMN IF NOT EXISTS units_per_purchase INTEGER NOT NULL DEFAULT 1 CHECK (units_per_purchase > 0);

ALTER TABLE public.product_purchase_order_lines
  ADD COLUMN IF NOT EXISTS units_per_purchase INTEGER NOT NULL DEFAULT 1 CHECK (units_per_purchase > 0);

CREATE TABLE IF NOT EXISTS public.product_purchase_order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.product_purchase_orders(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES public.product_attachments(id) ON DELETE CASCADE,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_po_attachments_order_id
  ON public.product_purchase_order_attachments(purchase_order_id);

ALTER TABLE public.product_purchase_order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_purchase_order_attachments_all ON public.product_purchase_order_attachments;
CREATE POLICY product_purchase_order_attachments_all
  ON public.product_purchase_order_attachments
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

COMMIT;


-- ===== Included migration: supabase/migrations/20260301050000_product_storage_bucket_policies.sql =====
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-files', 'product-files', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS product_files_select ON storage.objects;
CREATE POLICY product_files_select
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_insert ON storage.objects;
CREATE POLICY product_files_insert
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_update ON storage.objects;
CREATE POLICY product_files_update
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'product-files')
WITH CHECK (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_delete ON storage.objects;
CREATE POLICY product_files_delete
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'product-files');

COMMIT;


-- ===== Included migration: supabase/migrations/20260301130000_marketing_dashboard.sql =====
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
  supplies_needed TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover_asset_id UUID,
  outcome_summary TEXT,
  what_worked TEXT,
  what_didnt TEXT,
  recommendations TEXT,
  estimated_interactions INTEGER CHECK (estimated_interactions IS NULL OR estimated_interactions >= 0),
  units_sold INTEGER CHECK (units_sold IS NULL OR units_sold >= 0),
  revenue_impact NUMERIC(12,2) CHECK (revenue_impact IS NULL OR revenue_impact >= 0),
  engagement_notes TEXT,
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
  coordinator_contact TEXT,
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
  method TEXT NOT NULL DEFAULT 'email' CHECK (method IN ('email', 'call', 'in_person', 'text', 'other')),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  next_steps TEXT,
  next_steps_due_at DATE,
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


-- ===== Included migration: supabase/migrations/20260301183000_schedules_single_row_per_month.sql =====
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


-- ===== Included migration: supabase/migrations/20260301190000_meeting_attendance_source_of_truth.sql =====
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


-- ===== Included migration: supabase/migrations/20260302100000_marketing_contacts_and_internal_coordinators.sql =====
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


-- ===== Included migration: supabase/migrations/20260302113000_marketing_reports_standalone.sql =====
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


-- ===== Included migration: supabase/migrations/20260302130000_marketing_event_categories.sql =====
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


-- ===== Included migration: supabase/migrations/20260302150000_product_categories_and_catalog_defaults.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  parent_category_id UUID REFERENCES public.product_categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_categories_unique_name_per_parent UNIQUE (name, parent_category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_parent
  ON public.product_categories(parent_category_id, sort_order, name);

ALTER TABLE public.product_products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS default_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK (default_order_quantity > 0);

CREATE INDEX IF NOT EXISTS idx_product_products_category_id
  ON public.product_products(category_id);

CREATE INDEX IF NOT EXISTS idx_product_products_subcategory_id
  ON public.product_products(subcategory_id);

UPDATE public.product_products
SET notes = category
WHERE notes IS NULL
  AND category IS NOT NULL;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_categories_all ON public.product_categories;
CREATE POLICY product_categories_all
  ON public.product_categories
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_product_categories_updated_at ON public.product_categories;
CREATE TRIGGER update_product_categories_updated_at
BEFORE UPDATE ON public.product_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;


-- ===== Included migration: supabase/migrations/20260302173000_product_order_lines_required_link_and_product.sql =====
BEGIN;

UPDATE public.product_purchase_order_lines
SET custom_item_name = NULL
WHERE custom_item_name IS NOT NULL
  AND product_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_product_required'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_product_required
      CHECK (product_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_link_required'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_link_required
      CHECK (btrim(coalesce(product_link, '')) <> '')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_link_http'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_link_http
      CHECK (product_link ~* '^https?://')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_custom_item_unused'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_custom_item_unused
      CHECK (custom_item_name IS NULL OR btrim(custom_item_name) = '')
      NOT VALID;
  END IF;
END $$;

COMMIT;


-- ===== Included migration: supabase/migrations/20260302190000_orders_page_required_line_fields.sql =====
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_product_required_v2'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_product_required_v2
      CHECK (product_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_link_required_v2'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_link_required_v2
      CHECK (btrim(coalesce(product_link, '')) <> '')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_link_http_v2'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_link_http_v2
      CHECK (product_link ~* '^https?://')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_po_lines_custom_item_unused_v2'
      AND conrelid = 'public.product_purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.product_purchase_order_lines
      ADD CONSTRAINT product_po_lines_custom_item_unused_v2
      CHECK (custom_item_name IS NULL OR btrim(custom_item_name) = '')
      NOT VALID;
  END IF;
END $$;

COMMIT;


-- ===== Included migration: supabase/migrations/20260302200000_product_order_line_item_attachments.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS public.product_purchase_order_line_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_line_id UUID NOT NULL REFERENCES public.product_purchase_order_lines(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES public.product_attachments(id) ON DELETE CASCADE,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_po_line_attachments_line_id
  ON public.product_purchase_order_line_attachments(purchase_order_line_id);

ALTER TABLE public.product_purchase_order_line_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_purchase_order_line_attachments_all ON public.product_purchase_order_line_attachments;
CREATE POLICY product_purchase_order_line_attachments_all
  ON public.product_purchase_order_line_attachments
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

COMMIT;


-- ===== Included migration: supabase/migrations/20260302231500_product_categories_flat_only.sql =====
BEGIN;

UPDATE public.product_categories
SET parent_category_id = NULL
WHERE parent_category_id IS NOT NULL;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, name, id) - 1 AS next_sort
  FROM public.product_categories
  WHERE is_active = true
)
UPDATE public.product_categories c
SET sort_order = ranked.next_sort,
    updated_by = COALESCE(updated_by, 'dashboard')
FROM ranked
WHERE c.id = ranked.id;

ALTER TABLE public.product_categories
  DROP CONSTRAINT IF EXISTS product_categories_no_subcategories;

ALTER TABLE public.product_categories
  ADD CONSTRAINT product_categories_no_subcategories
  CHECK (parent_category_id IS NULL);

UPDATE public.product_products
SET subcategory_id = NULL
WHERE subcategory_id IS NOT NULL;

ALTER TABLE public.product_products
  DROP CONSTRAINT IF EXISTS product_products_no_subcategory;

ALTER TABLE public.product_products
  ADD CONSTRAINT product_products_no_subcategory
  CHECK (subcategory_id IS NULL);

COMMIT;


-- ===== Included migration: supabase/migrations/20260302235500_product_categories_color_key.sql =====
BEGIN;

ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS color_key TEXT;

UPDATE public.product_categories
SET color_key = 'slate'
WHERE color_key IS NULL
   OR btrim(color_key) = '';

ALTER TABLE public.product_categories
  ALTER COLUMN color_key SET NOT NULL,
  ALTER COLUMN color_key SET DEFAULT 'slate';

ALTER TABLE public.product_categories
  DROP CONSTRAINT IF EXISTS product_categories_color_key_check;

ALTER TABLE public.product_categories
  ADD CONSTRAINT product_categories_color_key_check
  CHECK (
    color_key IN (
      'slate',
      'rose',
      'orange',
      'amber',
      'lime',
      'emerald',
      'teal',
      'cyan',
      'sky',
      'indigo',
      'violet'
    )
  );

COMMIT;


-- ===== Included migration: supabase/migrations/20260305113000_hr_shift_modes_and_strike_warnings.sql =====
BEGIN;

ALTER TABLE public.strikes
  ADD COLUMN IF NOT EXISTS record_type TEXT,
  ADD COLUMN IF NOT EXISTS warning_description TEXT;

UPDATE public.strikes
SET record_type = 'strike'
WHERE record_type IS NULL;

ALTER TABLE public.strikes
  ALTER COLUMN record_type SET DEFAULT 'strike',
  ALTER COLUMN record_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'strikes_record_type_check'
      AND conrelid = 'public.strikes'::regclass
  ) THEN
    ALTER TABLE public.strikes
      ADD CONSTRAINT strikes_record_type_check
      CHECK (record_type IN ('strike', 'warning'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'strikes_warning_description_required_check'
      AND conrelid = 'public.strikes'::regclass
  ) THEN
    ALTER TABLE public.strikes
      ADD CONSTRAINT strikes_warning_description_required_check
      CHECK (
        record_type <> 'warning'
        OR (warning_description IS NOT NULL AND btrim(warning_description) <> '')
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_strikes_record_type_active
  ON public.strikes(record_type, active, issued_at DESC);

COMMIT;


-- ===== Included migration: supabase/migrations/20260305120000_shift_attendance_default_present_seed.sql =====
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


-- ===== Included migration: supabase/migrations/20260305124000_morning_and_off_period_shift_attendance_tables.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS public.morning_shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  raw_status TEXT,
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'morning_shift_attendance_raw_status_check'
      AND conrelid = 'public.morning_shift_attendance'::regclass
  ) THEN
    ALTER TABLE public.morning_shift_attendance
      ADD CONSTRAINT morning_shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_lookup
  ON public.morning_shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_date_period
  ON public.morning_shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_morning_shift_attendance_slot
  ON public.morning_shift_attendance(shift_date, shift_period, shift_slot_key);

CREATE TABLE IF NOT EXISTS public.off_period_shift_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date DATE NOT NULL,
  shift_period INTEGER NOT NULL CHECK (shift_period BETWEEN 0 AND 8),
  shift_slot_key TEXT NOT NULL CHECK (shift_slot_key <> ''),
  employee_s_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expected', 'present', 'absent', 'excused')),
  raw_status TEXT,
  source TEXT NOT NULL CHECK (source IN ('scheduler', 'manual', 'shift_exchange', 'rebuild')),
  reason TEXT,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_date, shift_period, shift_slot_key, employee_s_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'off_period_shift_attendance_raw_status_check'
      AND conrelid = 'public.off_period_shift_attendance'::regclass
  ) THEN
    ALTER TABLE public.off_period_shift_attendance
      ADD CONSTRAINT off_period_shift_attendance_raw_status_check
      CHECK (raw_status IS NULL OR raw_status IN ('expected', 'present', 'absent', 'excused'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_lookup
  ON public.off_period_shift_attendance(employee_s_number, shift_date);
CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_date_period
  ON public.off_period_shift_attendance(shift_date, shift_period);
CREATE INDEX IF NOT EXISTS idx_off_period_shift_attendance_slot
  ON public.off_period_shift_attendance(shift_date, shift_period, shift_slot_key);

ALTER TABLE public.morning_shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.off_period_shift_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access_morning_shift_attendance ON public.morning_shift_attendance;
CREATE POLICY open_access_morning_shift_attendance
  ON public.morning_shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS open_access_off_period_shift_attendance ON public.off_period_shift_attendance;
CREATE POLICY open_access_off_period_shift_attendance
  ON public.off_period_shift_attendance FOR ALL
  USING (true)
  WITH CHECK (true);

INSERT INTO public.morning_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
WHERE sa.shift_period = 0
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

INSERT INTO public.off_period_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
LEFT JOIN public.employee_settings es
  ON es.employee_s_number = sa.employee_s_number
WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::integer[]))
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

COMMIT;


-- ===== Included migration: supabase/migrations/20260305130000_sync_split_shift_attendance_from_regular.sql =====
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_regular()
RETURNS TRIGGER AS $$
DECLARE
  effective_off_periods INTEGER[];
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.morning_shift_attendance
    WHERE shift_date = OLD.shift_date
      AND shift_period = OLD.shift_period
      AND shift_slot_key = OLD.shift_slot_key
      AND employee_s_number = OLD.employee_s_number;

    DELETE FROM public.off_period_shift_attendance
    WHERE shift_date = OLD.shift_date
      AND shift_period = OLD.shift_period
      AND shift_slot_key = OLD.shift_slot_key
      AND employee_s_number = OLD.employee_s_number;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.shift_period = 0 THEN
    INSERT INTO public.morning_shift_attendance (
      shift_date,
      shift_period,
      shift_slot_key,
      employee_s_number,
      status,
      raw_status,
      source,
      reason,
      marked_by,
      marked_at
    ) VALUES (
      NEW.shift_date,
      NEW.shift_period,
      NEW.shift_slot_key,
      NEW.employee_s_number,
      NEW.status,
      NEW.raw_status,
      NEW.source,
      NEW.reason,
      NEW.marked_by,
      NEW.marked_at
    )
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;
  END IF;

  SELECT COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[])
  INTO effective_off_periods
  FROM public.employee_settings es
  WHERE es.employee_s_number = NEW.employee_s_number
  LIMIT 1;

  effective_off_periods := COALESCE(effective_off_periods, ARRAY[4,8]::INTEGER[]);

  IF NEW.shift_period = ANY(effective_off_periods) THEN
    INSERT INTO public.off_period_shift_attendance (
      shift_date,
      shift_period,
      shift_slot_key,
      employee_s_number,
      status,
      raw_status,
      source,
      reason,
      marked_by,
      marked_at
    ) VALUES (
      NEW.shift_date,
      NEW.shift_period,
      NEW.shift_slot_key,
      NEW.employee_s_number,
      NEW.status,
      NEW.raw_status,
      NEW.source,
      NEW.reason,
      NEW.marked_by,
      NEW.marked_at
    )
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_regular ON public.shift_attendance;
CREATE TRIGGER trg_sync_split_shift_attendance_from_regular
AFTER INSERT OR UPDATE OR DELETE ON public.shift_attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_regular();

-- Ensure current rows are fully synchronized after trigger creation.
INSERT INTO public.morning_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
WHERE sa.shift_period = 0
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

INSERT INTO public.off_period_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
LEFT JOIN public.employee_settings es
  ON es.employee_s_number = sa.employee_s_number
WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

DELETE FROM public.morning_shift_attendance msa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shift_attendance sa
  WHERE sa.shift_date = msa.shift_date
    AND sa.shift_period = msa.shift_period
    AND sa.shift_slot_key = msa.shift_slot_key
    AND sa.employee_s_number = msa.employee_s_number
    AND sa.shift_period = 0
);

DELETE FROM public.off_period_shift_attendance opsa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shift_attendance sa
  LEFT JOIN public.employee_settings es
    ON es.employee_s_number = sa.employee_s_number
  WHERE sa.shift_date = opsa.shift_date
    AND sa.shift_period = opsa.shift_period
    AND sa.shift_slot_key = opsa.shift_slot_key
    AND sa.employee_s_number = opsa.employee_s_number
    AND sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
);

COMMIT;


-- ===== Included migration: supabase/migrations/20260305133000_repair_split_shift_attendance_backfill.sql =====
BEGIN;

-- Force-rebuild split attendance tables from shift_attendance source-of-truth.
DELETE FROM public.morning_shift_attendance;
DELETE FROM public.off_period_shift_attendance;

INSERT INTO public.morning_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
WHERE sa.shift_period = 0
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

INSERT INTO public.off_period_shift_attendance (
  shift_date,
  shift_period,
  shift_slot_key,
  employee_s_number,
  status,
  raw_status,
  source,
  reason,
  marked_by,
  marked_at
)
SELECT
  sa.shift_date,
  sa.shift_period,
  sa.shift_slot_key,
  sa.employee_s_number,
  sa.status,
  sa.raw_status,
  sa.source,
  sa.reason,
  sa.marked_by,
  sa.marked_at
FROM public.shift_attendance sa
LEFT JOIN public.employee_settings es
  ON es.employee_s_number = sa.employee_s_number
WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
DO UPDATE SET
  status = EXCLUDED.status,
  raw_status = EXCLUDED.raw_status,
  source = EXCLUDED.source,
  reason = EXCLUDED.reason,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

COMMIT;


-- ===== Included migration: supabase/migrations/20260305134500_harden_split_shift_sync_triggers.sql =====
BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_split_shift_attendance(p_employee_s_number TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF p_employee_s_number IS NULL THEN
    DELETE FROM public.morning_shift_attendance;
    DELETE FROM public.off_period_shift_attendance;

    INSERT INTO public.morning_shift_attendance (
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
    FROM public.shift_attendance sa
    WHERE sa.shift_period = 0
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;

    INSERT INTO public.off_period_shift_attendance (
      shift_date, shift_period, shift_slot_key, employee_s_number,
      status, raw_status, source, reason, marked_by, marked_at
    )
    SELECT
      sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
      sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
    FROM public.shift_attendance sa
    LEFT JOIN public.employee_settings es
      ON es.employee_s_number = sa.employee_s_number
    WHERE sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
    ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      raw_status = EXCLUDED.raw_status,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      marked_by = EXCLUDED.marked_by,
      marked_at = EXCLUDED.marked_at;

    RETURN;
  END IF;

  DELETE FROM public.morning_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  DELETE FROM public.off_period_shift_attendance
  WHERE employee_s_number = p_employee_s_number;

  INSERT INTO public.morning_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.shift_attendance sa
  WHERE sa.employee_s_number = p_employee_s_number
    AND sa.shift_period = 0
  ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
  DO UPDATE SET
    status = EXCLUDED.status,
    raw_status = EXCLUDED.raw_status,
    source = EXCLUDED.source,
    reason = EXCLUDED.reason,
    marked_by = EXCLUDED.marked_by,
    marked_at = EXCLUDED.marked_at;

  INSERT INTO public.off_period_shift_attendance (
    shift_date, shift_period, shift_slot_key, employee_s_number,
    status, raw_status, source, reason, marked_by, marked_at
  )
  SELECT
    sa.shift_date, sa.shift_period, sa.shift_slot_key, sa.employee_s_number,
    sa.status, sa.raw_status, sa.source, sa.reason, sa.marked_by, sa.marked_at
  FROM public.shift_attendance sa
  LEFT JOIN public.employee_settings es
    ON es.employee_s_number = sa.employee_s_number
  WHERE sa.employee_s_number = p_employee_s_number
    AND sa.shift_period = ANY(COALESCE(es.off_periods, ARRAY[4,8]::INTEGER[]))
  ON CONFLICT (shift_date, shift_period, shift_slot_key, employee_s_number)
  DO UPDATE SET
    status = EXCLUDED.status,
    raw_status = EXCLUDED.raw_status,
    source = EXCLUDED.source,
    reason = EXCLUDED.reason,
    marked_by = EXCLUDED.marked_by,
    marked_at = EXCLUDED.marked_at;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_regular()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_regular ON public.shift_attendance;
CREATE TRIGGER trg_sync_split_shift_attendance_from_regular
AFTER INSERT OR UPDATE OR DELETE ON public.shift_attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_regular();

CREATE OR REPLACE FUNCTION public.sync_split_shift_attendance_from_employee_settings()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.employee_s_number IS DISTINCT FROM NEW.employee_s_number THEN
      PERFORM public.rebuild_split_shift_attendance(OLD.employee_s_number);
    END IF;
    PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
    RETURN NEW;
  END IF;

  PERFORM public.rebuild_split_shift_attendance(NEW.employee_s_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_split_shift_attendance_from_employee_settings ON public.employee_settings;
CREATE TRIGGER trg_sync_split_shift_attendance_from_employee_settings
AFTER INSERT OR UPDATE OR DELETE ON public.employee_settings
FOR EACH ROW
EXECUTE FUNCTION public.sync_split_shift_attendance_from_employee_settings();

-- Immediate repair/backfill for existing data.
SELECT public.rebuild_split_shift_attendance(NULL);

COMMIT;

-- ===== Departmental HR canonical layer and sync =====
BEGIN;

CREATE TABLE IF NOT EXISTS public.hr_strikes (LIKE public.strikes INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_shift_change_requests (LIKE public.shift_change_requests INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_points_ledger (LIKE public.points_ledger INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_audit_log (LIKE public.audit_log INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_user_roles (LIKE public.user_roles INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_attendance_overrides (LIKE public.attendance_overrides INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_schedules (LIKE public.schedules INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_employee_settings (LIKE public.employee_settings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_shift_attendance (LIKE public.shift_attendance INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_morning_shift_attendance (LIKE public.morning_shift_attendance INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_off_period_shift_attendance (LIKE public.off_period_shift_attendance INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_meeting_attendance_records (LIKE public.meeting_attendance_records INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.hr_employee_login_credentials (LIKE public.employee_login_credentials INCLUDING ALL);

ALTER TABLE public.hr_strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_shift_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_morning_shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_off_period_shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_meeting_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employee_login_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_strikes_all ON public.hr_strikes;
CREATE POLICY hr_strikes_all ON public.hr_strikes FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_shift_change_requests_all ON public.hr_shift_change_requests;
CREATE POLICY hr_shift_change_requests_all ON public.hr_shift_change_requests FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_points_ledger_all ON public.hr_points_ledger;
CREATE POLICY hr_points_ledger_all ON public.hr_points_ledger FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_audit_log_all ON public.hr_audit_log;
CREATE POLICY hr_audit_log_all ON public.hr_audit_log FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_user_roles_all ON public.hr_user_roles;
CREATE POLICY hr_user_roles_all ON public.hr_user_roles FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_attendance_overrides_all ON public.hr_attendance_overrides;
CREATE POLICY hr_attendance_overrides_all ON public.hr_attendance_overrides FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_schedules_all ON public.hr_schedules;
CREATE POLICY hr_schedules_all ON public.hr_schedules FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_employee_settings_all ON public.hr_employee_settings;
CREATE POLICY hr_employee_settings_all ON public.hr_employee_settings FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_shift_attendance_all ON public.hr_shift_attendance;
CREATE POLICY hr_shift_attendance_all ON public.hr_shift_attendance FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_morning_shift_attendance_all ON public.hr_morning_shift_attendance;
CREATE POLICY hr_morning_shift_attendance_all ON public.hr_morning_shift_attendance FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_off_period_shift_attendance_all ON public.hr_off_period_shift_attendance;
CREATE POLICY hr_off_period_shift_attendance_all ON public.hr_off_period_shift_attendance FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_meeting_attendance_records_all ON public.hr_meeting_attendance_records;
CREATE POLICY hr_meeting_attendance_records_all ON public.hr_meeting_attendance_records FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hr_employee_login_credentials_all ON public.hr_employee_login_credentials;
CREATE POLICY hr_employee_login_credentials_all ON public.hr_employee_login_credentials FOR ALL TO public USING (true) WITH CHECK (true);

-- Future raw username/password table (kept empty by default).
CREATE TABLE IF NOT EXISTS public.hr_auth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id bigint NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  employee_uuid uuid NOT NULL REFERENCES public.students(employee_uuid) ON DELETE CASCADE,
  username text UNIQUE,
  password_hash text,
  password_salt text,
  password_algo text DEFAULT 'bcrypt',
  must_reset_password boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id),
  UNIQUE (employee_uuid)
);

ALTER TABLE public.hr_auth_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_auth_credentials_all ON public.hr_auth_credentials;
CREATE POLICY hr_auth_credentials_all
  ON public.hr_auth_credentials FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.hr_sync_pair()
RETURNS TRIGGER AS $$
DECLARE
  src text;
  dst text;
  key_col text;
  rec record;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  src := TG_ARGV[0];
  dst := TG_ARGV[1];
  key_col := TG_ARGV[2];

  IF TG_OP = 'DELETE' THEN
    EXECUTE format('DELETE FROM %s WHERE %I = $1.%I', dst, key_col, key_col) USING OLD;
    RETURN OLD;
  END IF;

  EXECUTE format('DELETE FROM %s WHERE %I = $1.%I', dst, key_col, key_col) USING NEW;
  EXECUTE format('INSERT INTO %s SELECT ($1).*', dst) USING NEW;

  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT $1.%I::text, $2.%I::text', key_col, key_col) INTO rec USING OLD, NEW;
    IF rec.f1 IS DISTINCT FROM rec.f2 THEN
      EXECUTE format('DELETE FROM %s WHERE %I = $1.%I', dst, key_col, key_col) USING OLD;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Main table + hr_* sync pairs.
DROP TRIGGER IF EXISTS trg_sync_strikes_to_hr ON public.strikes;
CREATE TRIGGER trg_sync_strikes_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.strikes
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.strikes','public.hr_strikes','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_strikes ON public.hr_strikes;
CREATE TRIGGER trg_sync_hr_to_strikes
AFTER INSERT OR UPDATE OR DELETE ON public.hr_strikes
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_strikes','public.strikes','id');

DROP TRIGGER IF EXISTS trg_sync_shift_change_requests_to_hr ON public.shift_change_requests;
CREATE TRIGGER trg_sync_shift_change_requests_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.shift_change_requests
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.shift_change_requests','public.hr_shift_change_requests','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_shift_change_requests ON public.hr_shift_change_requests;
CREATE TRIGGER trg_sync_hr_to_shift_change_requests
AFTER INSERT OR UPDATE OR DELETE ON public.hr_shift_change_requests
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_shift_change_requests','public.shift_change_requests','id');

DROP TRIGGER IF EXISTS trg_sync_points_ledger_to_hr ON public.points_ledger;
CREATE TRIGGER trg_sync_points_ledger_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.points_ledger
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.points_ledger','public.hr_points_ledger','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_points_ledger ON public.hr_points_ledger;
CREATE TRIGGER trg_sync_hr_to_points_ledger
AFTER INSERT OR UPDATE OR DELETE ON public.hr_points_ledger
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_points_ledger','public.points_ledger','id');

DROP TRIGGER IF EXISTS trg_sync_audit_log_to_hr ON public.audit_log;
CREATE TRIGGER trg_sync_audit_log_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.audit_log','public.hr_audit_log','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_audit_log ON public.hr_audit_log;
CREATE TRIGGER trg_sync_hr_to_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.hr_audit_log
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_audit_log','public.audit_log','id');

DROP TRIGGER IF EXISTS trg_sync_user_roles_to_hr ON public.user_roles;
CREATE TRIGGER trg_sync_user_roles_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.user_roles','public.hr_user_roles','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_user_roles ON public.hr_user_roles;
CREATE TRIGGER trg_sync_hr_to_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.hr_user_roles
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_user_roles','public.user_roles','id');

DROP TRIGGER IF EXISTS trg_sync_attendance_overrides_to_hr ON public.attendance_overrides;
CREATE TRIGGER trg_sync_attendance_overrides_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_overrides
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.attendance_overrides','public.hr_attendance_overrides','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_attendance_overrides ON public.hr_attendance_overrides;
CREATE TRIGGER trg_sync_hr_to_attendance_overrides
AFTER INSERT OR UPDATE OR DELETE ON public.hr_attendance_overrides
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_attendance_overrides','public.attendance_overrides','id');

DROP TRIGGER IF EXISTS trg_sync_schedules_to_hr ON public.schedules;
CREATE TRIGGER trg_sync_schedules_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.schedules','public.hr_schedules','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_schedules ON public.hr_schedules;
CREATE TRIGGER trg_sync_hr_to_schedules
AFTER INSERT OR UPDATE OR DELETE ON public.hr_schedules
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_schedules','public.schedules','id');

DROP TRIGGER IF EXISTS trg_sync_employee_settings_to_hr ON public.employee_settings;
CREATE TRIGGER trg_sync_employee_settings_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.employee_settings
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.employee_settings','public.hr_employee_settings','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_employee_settings ON public.hr_employee_settings;
CREATE TRIGGER trg_sync_hr_to_employee_settings
AFTER INSERT OR UPDATE OR DELETE ON public.hr_employee_settings
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_employee_settings','public.employee_settings','id');

DROP TRIGGER IF EXISTS trg_sync_shift_attendance_to_hr ON public.shift_attendance;
CREATE TRIGGER trg_sync_shift_attendance_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.shift_attendance','public.hr_shift_attendance','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_shift_attendance ON public.hr_shift_attendance;
CREATE TRIGGER trg_sync_hr_to_shift_attendance
AFTER INSERT OR UPDATE OR DELETE ON public.hr_shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_shift_attendance','public.shift_attendance','id');

DROP TRIGGER IF EXISTS trg_sync_morning_shift_attendance_to_hr ON public.morning_shift_attendance;
CREATE TRIGGER trg_sync_morning_shift_attendance_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.morning_shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.morning_shift_attendance','public.hr_morning_shift_attendance','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_morning_shift_attendance ON public.hr_morning_shift_attendance;
CREATE TRIGGER trg_sync_hr_to_morning_shift_attendance
AFTER INSERT OR UPDATE OR DELETE ON public.hr_morning_shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_morning_shift_attendance','public.morning_shift_attendance','id');

DROP TRIGGER IF EXISTS trg_sync_off_period_shift_attendance_to_hr ON public.off_period_shift_attendance;
CREATE TRIGGER trg_sync_off_period_shift_attendance_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.off_period_shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.off_period_shift_attendance','public.hr_off_period_shift_attendance','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_off_period_shift_attendance ON public.hr_off_period_shift_attendance;
CREATE TRIGGER trg_sync_hr_to_off_period_shift_attendance
AFTER INSERT OR UPDATE OR DELETE ON public.hr_off_period_shift_attendance
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_off_period_shift_attendance','public.off_period_shift_attendance','id');

DROP TRIGGER IF EXISTS trg_sync_meeting_attendance_records_to_hr ON public.meeting_attendance_records;
CREATE TRIGGER trg_sync_meeting_attendance_records_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.meeting_attendance_records
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.meeting_attendance_records','public.hr_meeting_attendance_records','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_meeting_attendance_records ON public.hr_meeting_attendance_records;
CREATE TRIGGER trg_sync_hr_to_meeting_attendance_records
AFTER INSERT OR UPDATE OR DELETE ON public.hr_meeting_attendance_records
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_meeting_attendance_records','public.meeting_attendance_records','id');

DROP TRIGGER IF EXISTS trg_sync_employee_login_credentials_to_hr ON public.employee_login_credentials;
CREATE TRIGGER trg_sync_employee_login_credentials_to_hr
AFTER INSERT OR UPDATE OR DELETE ON public.employee_login_credentials
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.employee_login_credentials','public.hr_employee_login_credentials','id');
DROP TRIGGER IF EXISTS trg_sync_hr_to_employee_login_credentials ON public.hr_employee_login_credentials;
CREATE TRIGGER trg_sync_hr_to_employee_login_credentials
AFTER INSERT OR UPDATE OR DELETE ON public.hr_employee_login_credentials
FOR EACH ROW EXECUTE FUNCTION public.hr_sync_pair('public.hr_employee_login_credentials','public.employee_login_credentials','id');

-- Keep hr_auth_credentials aligned with employee_login_credentials for future non-auth based login.
CREATE OR REPLACE FUNCTION public.sync_hr_auth_credentials_from_employee_login()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_uuid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.hr_auth_credentials WHERE employee_id = OLD.employee_id;
    RETURN OLD;
  END IF;

  SELECT employee_uuid INTO v_employee_uuid
  FROM public.students
  WHERE id = NEW.employee_id;

  INSERT INTO public.hr_auth_credentials (
    employee_id,
    employee_uuid,
    username,
    password_hash,
    updated_at,
    created_at
  ) VALUES (
    NEW.employee_id,
    v_employee_uuid,
    NEW.username,
    NEW.password_hash,
    now(),
    COALESCE(NEW.created_at, now())
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    employee_uuid = EXCLUDED.employee_uuid,
    username = EXCLUDED.username,
    password_hash = EXCLUDED.password_hash,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_hr_auth_credentials_from_employee_login ON public.employee_login_credentials;
CREATE TRIGGER trg_sync_hr_auth_credentials_from_employee_login
AFTER INSERT OR UPDATE OR DELETE ON public.employee_login_credentials
FOR EACH ROW
EXECUTE FUNCTION public.sync_hr_auth_credentials_from_employee_login();

-- Backfill all HR mirrors from source tables.
INSERT INTO public.hr_strikes SELECT * FROM public.strikes ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_shift_change_requests SELECT * FROM public.shift_change_requests ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_points_ledger SELECT * FROM public.points_ledger ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_audit_log SELECT * FROM public.audit_log ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_user_roles SELECT * FROM public.user_roles ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_attendance_overrides SELECT * FROM public.attendance_overrides ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_schedules SELECT * FROM public.schedules ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_employee_settings SELECT * FROM public.employee_settings ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_shift_attendance SELECT * FROM public.shift_attendance ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_morning_shift_attendance SELECT * FROM public.morning_shift_attendance ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_off_period_shift_attendance SELECT * FROM public.off_period_shift_attendance ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_meeting_attendance_records SELECT * FROM public.meeting_attendance_records ON CONFLICT (id) DO NOTHING;
INSERT INTO public.hr_employee_login_credentials SELECT * FROM public.employee_login_credentials ON CONFLICT (id) DO NOTHING;

INSERT INTO public.hr_auth_credentials (employee_id, employee_uuid, username, password_hash)
SELECT s.id, s.employee_uuid, elc.username, elc.password_hash
FROM public.students s
LEFT JOIN public.employee_login_credentials elc ON elc.employee_id = s.id
ON CONFLICT (employee_id) DO NOTHING;

COMMIT;
