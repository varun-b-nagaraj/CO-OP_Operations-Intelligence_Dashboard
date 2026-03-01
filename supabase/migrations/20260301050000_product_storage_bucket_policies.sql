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
