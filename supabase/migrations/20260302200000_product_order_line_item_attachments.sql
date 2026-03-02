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
