# Backend Department Routes

All browser-originated Supabase requests are routed through:

- `/api/backend/hr/supabase/...`
- `/api/backend/marketing/supabase/...`
- `/api/backend/product/supabase/...`
- `/api/backend/inventory/supabase/...`
- `/api/backend/shared/supabase/...`

Routing is decided in `lib/supabase.ts` by table/path:

- `product_*` -> `product`
- `inventory_*` and `cfa_*` -> `inventory`
- `marketing_*` plus marketing contact/event tables -> `marketing`
- HR tables (`students`, `employee_settings`, `shift_attendance`, etc.) -> `hr`
- everything else -> `shared`

The legacy route `/api/supabase-proxy/...` remains as a compatibility alias and forwards through the shared backend handler.
