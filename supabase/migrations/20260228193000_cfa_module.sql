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
