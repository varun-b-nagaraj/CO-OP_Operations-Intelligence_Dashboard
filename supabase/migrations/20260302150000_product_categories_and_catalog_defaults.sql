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
