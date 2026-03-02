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
