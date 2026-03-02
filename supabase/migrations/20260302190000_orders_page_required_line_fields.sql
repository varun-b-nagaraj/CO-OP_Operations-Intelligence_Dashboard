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
