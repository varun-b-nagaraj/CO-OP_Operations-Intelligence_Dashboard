BEGIN;

-- Ensure canonical permission exists
INSERT INTO public.access_permissions (
  permission_key, department, resource, action, scope, label, is_active
)
VALUES (
  'inventory.catalog:view:all',
  'inventory',
  'catalog',
  'view',
  'all',
  'Inventory Catalog View',
  TRUE
)
ON CONFLICT (permission_key) DO UPDATE
SET
  department = EXCLUDED.department,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  label = EXCLUDED.label,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Move old role mappings to new key (if old key still exists)
INSERT INTO public.access_role_permissions (role_key, permission_key)
SELECT arp.role_key, 'inventory.catalog:view:all'
FROM public.access_role_permissions arp
WHERE arp.permission_key = 'inventory.catalog:view:own'
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Remove old mappings + old permission
DELETE FROM public.access_role_permissions
WHERE permission_key = 'inventory.catalog:view:own';

DELETE FROM public.access_permissions
WHERE permission_key = 'inventory.catalog:view:own';

-- Ensure expected baseline roles have view:all
INSERT INTO public.access_role_permissions (role_key, permission_key)
VALUES
  ('inventory_admin','inventory.catalog:view:all'),
  ('inventory_counter','inventory.catalog:view:all'),
  ('viewer','inventory.catalog:view:all')
ON CONFLICT (role_key, permission_key) DO NOTHING;

COMMIT;
