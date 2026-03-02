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
