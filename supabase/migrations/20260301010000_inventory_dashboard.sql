create extension if not exists pgcrypto;

-- String-safe helper columns and editability helpers on existing catalog table.
alter table public."Inventory"
  add column if not exists inventory_row_id bigint,
  add column if not exists system_id_text text,
  add column if not exists upc_text text,
  add column if not exists ean_text text,
  add column if not exists custom_sku_text text,
  add column if not exists manufact_sku_text text,
  add column if not exists inventory_deleted boolean not null default false,
  add column if not exists inventory_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_class
    where relkind = 'S'
      and relname = 'inventory_row_id_seq'
  ) then
    create sequence public.inventory_row_id_seq;
  end if;
end $$;

alter sequence public.inventory_row_id_seq owned by public."Inventory".inventory_row_id;
alter table public."Inventory" alter column inventory_row_id set default nextval('public.inventory_row_id_seq');

update public."Inventory"
set
  inventory_row_id = coalesce(inventory_row_id, nextval('public.inventory_row_id_seq')),
  system_id_text = coalesce(nullif(trim(system_id_text), ''), nullif(trim("System ID"::text), '')),
  upc_text = coalesce(nullif(trim(upc_text), ''), nullif(trim("UPC"::text), '')),
  ean_text = coalesce(nullif(trim(ean_text), ''), nullif(trim("EAN"), '')),
  custom_sku_text = coalesce(nullif(trim(custom_sku_text), ''), nullif(trim("Custom SKU"), '')),
  manufact_sku_text = coalesce(nullif(trim(manufact_sku_text), ''), nullif(trim("Manufact. SKU"), '')),
  inventory_updated_at = coalesce(inventory_updated_at, now());

create unique index if not exists inventory_row_id_uidx
  on public."Inventory" (inventory_row_id);

create index if not exists inventory_system_id_text_idx
  on public."Inventory" (system_id_text)
  where inventory_deleted = false;

create index if not exists inventory_upc_text_idx
  on public."Inventory" (upc_text)
  where inventory_deleted = false;

create index if not exists inventory_ean_text_idx
  on public."Inventory" (ean_text)
  where inventory_deleted = false;

create index if not exists inventory_custom_sku_text_idx
  on public."Inventory" (custom_sku_text)
  where inventory_deleted = false;

create index if not exists inventory_manufact_sku_text_idx
  on public."Inventory" (manufact_sku_text)
  where inventory_deleted = false;

create table if not exists public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null,
  status text not null default 'active' check (status in ('active', 'finalizing', 'locked')),
  host_id text not null,
  created_by text not null default 'open_access',
  baseline_session_id uuid null references public.inventory_sessions(id),
  last_sync_at timestamptz null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_sessions_status_idx on public.inventory_sessions(status);
create index if not exists inventory_sessions_created_at_idx on public.inventory_sessions(created_at desc);

create table if not exists public.inventory_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  participant_id text not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  event_count integer not null default 0,
  created_by text not null default 'open_access',
  unique(session_id, participant_id)
);

create index if not exists inventory_session_participants_session_idx
  on public.inventory_session_participants(session_id);

create table if not exists public.inventory_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  event_id text not null,
  actor_id text not null,
  system_id text not null,
  delta_qty integer not null,
  event_type text not null default 'SCAN',
  event_ts timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'open_access',
  unique(session_id, event_id)
);

create index if not exists inventory_session_events_session_system_idx
  on public.inventory_session_events(session_id, system_id);

create index if not exists inventory_session_events_session_actor_idx
  on public.inventory_session_events(session_id, actor_id);

create index if not exists inventory_session_events_ts_idx
  on public.inventory_session_events(event_ts);

create table if not exists public.inventory_session_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  snapshot_type text not null default 'sync',
  payload jsonb not null,
  created_by text not null default 'open_access',
  created_at timestamptz not null default now()
);

create index if not exists inventory_session_snapshots_session_idx
  on public.inventory_session_snapshots(session_id, created_at desc);

create table if not exists public.inventory_manual_overrides (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  system_id text not null,
  override_qty integer not null,
  reason text null,
  overridden_by text not null default 'open_access',
  created_at timestamptz not null default now(),
  unique(session_id, system_id)
);

create index if not exists inventory_manual_overrides_session_idx
  on public.inventory_manual_overrides(session_id);

create table if not exists public.inventory_session_final (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  system_id text not null,
  final_qty integer not null,
  finalized_by text not null default 'open_access',
  finalized_at timestamptz not null default now(),
  unique(session_id, system_id)
);

create index if not exists inventory_session_final_session_idx
  on public.inventory_session_final(session_id);

create table if not exists public.inventory_upload_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions(id) on delete cascade,
  triggered_by text not null default 'open_access',
  count_name text not null,
  shop_id text not null default '1',
  employee_id text not null default '1',
  reconcile boolean not null default true,
  omitted_items_zeroed_warning boolean not null default true,
  request_item_count integer not null default 0,
  request_payload_hash text not null,
  response_status integer not null,
  response_summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_upload_runs_session_idx
  on public.inventory_upload_runs(session_id, created_at desc);

create index if not exists inventory_upload_runs_hash_idx
  on public.inventory_upload_runs(request_payload_hash);

alter table public.inventory_sessions enable row level security;
alter table public.inventory_session_participants enable row level security;
alter table public.inventory_session_events enable row level security;
alter table public.inventory_session_snapshots enable row level security;
alter table public.inventory_manual_overrides enable row level security;
alter table public.inventory_session_final enable row level security;
alter table public.inventory_upload_runs enable row level security;

-- V1 open-access policies, keep created_by/host_id structure for future RBAC.
drop policy if exists inventory_sessions_all on public.inventory_sessions;
create policy inventory_sessions_all on public.inventory_sessions for all to public using (true) with check (true);

drop policy if exists inventory_session_participants_all on public.inventory_session_participants;
create policy inventory_session_participants_all on public.inventory_session_participants for all to public using (true) with check (true);

drop policy if exists inventory_session_events_all on public.inventory_session_events;
create policy inventory_session_events_all on public.inventory_session_events for all to public using (true) with check (true);

drop policy if exists inventory_session_snapshots_all on public.inventory_session_snapshots;
create policy inventory_session_snapshots_all on public.inventory_session_snapshots for all to public using (true) with check (true);

drop policy if exists inventory_manual_overrides_all on public.inventory_manual_overrides;
create policy inventory_manual_overrides_all on public.inventory_manual_overrides for all to public using (true) with check (true);

drop policy if exists inventory_session_final_all on public.inventory_session_final;
create policy inventory_session_final_all on public.inventory_session_final for all to public using (true) with check (true);

drop policy if exists inventory_upload_runs_all on public.inventory_upload_runs;
create policy inventory_upload_runs_all on public.inventory_upload_runs for all to public using (true) with check (true);
