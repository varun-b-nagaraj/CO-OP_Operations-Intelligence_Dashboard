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
