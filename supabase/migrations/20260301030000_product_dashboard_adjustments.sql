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
