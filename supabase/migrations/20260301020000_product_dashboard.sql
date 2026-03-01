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
