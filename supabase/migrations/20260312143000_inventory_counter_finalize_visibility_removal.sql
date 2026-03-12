BEGIN;

DELETE FROM public.access_role_permissions
WHERE role_key = 'inventory_counter'
  AND permission_key = 'inventory.finalize_upload:view:own';

COMMIT;
