BEGIN;

UPDATE public.access_permissions
SET permission_key = 'inventory.catalog:view:all', scope = 'all', updated_at = NOW()
WHERE permission_key = 'inventory.catalog:view:own';

INSERT INTO public.access_permissions (
  permission_key, department, resource, action, scope, label, is_active
)
VALUES ('inventory.catalog:view:all','inventory','catalog','view','all','Inventory Catalog View',TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET scope = EXCLUDED.scope, updated_at = NOW();

DELETE FROM public.access_role_permissions
WHERE permission_key = 'inventory.catalog:view:own';

INSERT INTO public.access_role_permissions (role_key, permission_key)
VALUES
  ('inventory_admin','inventory.catalog:view:all'),
  ('inventory_counter','inventory.catalog:view:all'),
  ('viewer','inventory.catalog:view:all')
ON CONFLICT (role_key, permission_key) DO NOTHING;

COMMIT;
