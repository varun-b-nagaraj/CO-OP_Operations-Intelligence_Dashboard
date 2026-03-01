import crypto from 'crypto';

import { SupabaseClient } from '@supabase/supabase-js';

import { normalizeIdentifier } from '@/lib/inventory/identifiers';
import {
  CatalogUpsertInput,
  InventoryCatalogItem,
  InventoryCountEvent,
  InventoryItemTotal,
  InventorySession,
  InventorySessionState,
  InventoryUploadSummary
} from '@/lib/inventory/types';

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMaybeBigint(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const asNum = Number(value);
  return Number.isSafeInteger(asNum) ? asNum : null;
}

export function mapInventoryRow(row: Record<string, unknown>): InventoryCatalogItem {
  return {
    row_id: Number(row.inventory_row_id ?? 0),
    system_id: normalizeIdentifier(row.system_id_text ?? row['System ID']),
    upc: normalizeIdentifier(row.upc_text ?? row.UPC),
    ean: normalizeIdentifier(row.ean_text ?? row.EAN),
    custom_sku: normalizeIdentifier(row.custom_sku_text ?? row['Custom SKU']),
    manufact_sku: normalizeIdentifier(row.manufact_sku_text ?? row['Manufact. SKU']),
    item_name: asString(row.Item),
    vendor_id: asString(row['Vendor ID']),
    price: asString(row.Price),
    tax: asString(row.Tax),
    brand: asString(row.Brand),
    publish_to_ecom: asString(row['Publish to eCom']),
    season: asString(row.Season),
    department: asString(row.Department),
    msrp: asString(row.MSRP),
    tax_class: asString(row['Tax Class']),
    default_cost: row['Default Cost'] === null || row['Default Cost'] === undefined
      ? null
      : Number(row['Default Cost']),
    vendor: asString(row.Vendor),
    category: asString(row.Category),
    subcategory_1: asString(row['Subcategory 1']),
    subcategory_2: asString(row['Subcategory 2']),
    subcategory_3: asString(row['Subcategory 3']),
    subcategory_4: asString(row['Subcategory 4']),
    subcategory_5: asString(row['Subcategory 5']),
    subcategory_6: asString(row['Subcategory 6']),
    subcategory_7: asString(row['Subcategory 7']),
    subcategory_8: asString(row['Subcategory 8']),
    subcategory_9: asString(row['Subcategory 9']),
    deleted: Boolean(row.inventory_deleted ?? false),
    updated_at: (row.inventory_updated_at as string | null) ?? null
  };
}

function inventoryWritePayload(input: CatalogUpsertInput): Record<string, unknown> {
  const systemId = normalizeIdentifier(input.system_id);
  const upc = normalizeIdentifier(input.upc ?? '');
  const ean = normalizeIdentifier(input.ean ?? '');
  const customSku = normalizeIdentifier(input.custom_sku ?? '');
  const manufactSku = normalizeIdentifier(input.manufact_sku ?? '');

  return {
    system_id_text: systemId,
    upc_text: upc,
    ean_text: ean,
    custom_sku_text: customSku,
    manufact_sku_text: manufactSku,
    'System ID': toMaybeBigint(systemId),
    UPC: toMaybeBigint(upc),
    EAN: ean,
    'Custom SKU': customSku,
    'Manufact. SKU': manufactSku,
    Item: asString(input.item_name),
    'Vendor ID': asString(input.vendor_id),
    Price: asString(input.price),
    Tax: asString(input.tax),
    Brand: asString(input.brand),
    'Publish to eCom': asString(input.publish_to_ecom),
    Season: asString(input.season),
    Department: asString(input.department),
    MSRP: asString(input.msrp),
    'Tax Class': asString(input.tax_class),
    'Default Cost': input.default_cost ?? parseNumber(asString(input.default_cost ?? '')),
    Vendor: asString(input.vendor),
    Category: asString(input.category),
    'Subcategory 1': asString(input.subcategory_1),
    'Subcategory 2': asString(input.subcategory_2),
    'Subcategory 3': asString(input.subcategory_3),
    'Subcategory 4': asString(input.subcategory_4),
    'Subcategory 5': asString(input.subcategory_5),
    'Subcategory 6': asString(input.subcategory_6),
    'Subcategory 7': asString(input.subcategory_7),
    'Subcategory 8': asString(input.subcategory_8),
    'Subcategory 9': asString(input.subcategory_9),
    inventory_updated_at: new Date().toISOString(),
    inventory_deleted: false
  };
}

export async function listCatalog(
  supabase: SupabaseClient,
  query?: string
): Promise<InventoryCatalogItem[]> {
  let request = supabase
    .from('Inventory')
    .select('*')
    .eq('inventory_deleted', false)
    .order('inventory_row_id', { ascending: true })
    .limit(5000);

  if (query?.trim()) {
    const q = query.trim();
    request = request.or(
      [`system_id_text.ilike.%${q}%`, `upc_text.ilike.%${q}%`, `ean_text.ilike.%${q}%`, `Item.ilike.%${q}%`].join(',')
    );
  }

  const { data, error } = await request;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapInventoryRow(row as Record<string, unknown>));
}

async function findCatalogMatch(
  supabase: SupabaseClient,
  input: CatalogUpsertInput
): Promise<InventoryCatalogItem | null> {
  if (input.row_id) {
    const { data, error } = await supabase
      .from('Inventory')
      .select('*')
      .eq('inventory_row_id', input.row_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? mapInventoryRow(data as Record<string, unknown>) : null;
  }

  const lookups: Array<{ column: string; value: string }> = [
    { column: 'upc_text', value: normalizeIdentifier(input.upc) },
    { column: 'ean_text', value: normalizeIdentifier(input.ean) },
    { column: 'system_id_text', value: normalizeIdentifier(input.system_id) },
    { column: 'custom_sku_text', value: normalizeIdentifier(input.custom_sku) },
    { column: 'manufact_sku_text', value: normalizeIdentifier(input.manufact_sku) }
  ];

  for (const lookup of lookups) {
    if (!lookup.value) continue;

    const { data, error } = await supabase
      .from('Inventory')
      .select('*')
      .eq(lookup.column, lookup.value)
      .eq('inventory_deleted', false)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) {
      return mapInventoryRow(data as Record<string, unknown>);
    }
  }

  return null;
}

export async function upsertCatalogItem(
  supabase: SupabaseClient,
  input: CatalogUpsertInput
): Promise<InventoryCatalogItem> {
  const match = await findCatalogMatch(supabase, input);
  const payload = inventoryWritePayload(input);

  if (match) {
    const { data, error } = await supabase
      .from('Inventory')
      .update(payload)
      .eq('inventory_row_id', match.row_id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update catalog item');
    }

    return mapInventoryRow(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from('Inventory')
    .insert(payload)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to insert catalog item');
  }

  return mapInventoryRow(data as Record<string, unknown>);
}

export async function softDeleteCatalogItem(
  supabase: SupabaseClient,
  rowId: number
): Promise<void> {
  const { error } = await supabase
    .from('Inventory')
    .update({ inventory_deleted: true, inventory_updated_at: new Date().toISOString() })
    .eq('inventory_row_id', rowId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createInventorySession(
  supabase: SupabaseClient,
  input: { session_name: string; host_id: string; created_by: string; baseline_session_id?: string | null }
): Promise<InventorySession> {
  const { data, error } = await supabase
    .from('inventory_sessions')
    .insert({
      session_name: input.session_name,
      host_id: input.host_id,
      created_by: input.created_by,
      baseline_session_id: input.baseline_session_id ?? null,
      status: 'active'
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create session');
  }

  return data as InventorySession;
}

export async function upsertParticipant(
  supabase: SupabaseClient,
  sessionId: string,
  participantId: string,
  displayName: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('inventory_session_participants').upsert(
    {
      session_id: sessionId,
      participant_id: participantId,
      display_name: displayName,
      last_seen_at: now
    },
    {
      onConflict: 'session_id,participant_id'
    }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function commitEvents(
  supabase: SupabaseClient,
  input: {
    session_id: string;
    actor_id: string;
    actor_name: string;
    events: InventoryCountEvent[];
  }
): Promise<{ inserted: number; totals: InventoryItemTotal[]; last_sync_at: string }> {
  await upsertParticipant(supabase, input.session_id, input.actor_id, input.actor_name);

  if (input.events.length > 0) {
    const rows = input.events.map((event) => ({
      session_id: input.session_id,
      event_id: event.event_id,
      actor_id: event.actor_id,
      system_id: normalizeIdentifier(event.system_id),
      delta_qty: event.delta_qty,
      event_ts: event.timestamp,
      created_by: input.actor_id
    }));

    const { error } = await supabase
      .from('inventory_session_events')
      .upsert(rows, { onConflict: 'session_id,event_id', ignoreDuplicates: true });

    if (error) {
      throw new Error(error.message);
    }
  }

  const { data: totalsRows, error: totalsError } = await supabase
    .from('inventory_session_events')
    .select('system_id,delta_qty')
    .eq('session_id', input.session_id);

  if (totalsError) {
    throw new Error(totalsError.message);
  }

  const totalsMap = new Map<string, number>();
  for (const row of totalsRows ?? []) {
    const systemId = normalizeIdentifier((row as { system_id: string }).system_id);
    const delta = Number((row as { delta_qty: number }).delta_qty) || 0;
    totalsMap.set(systemId, (totalsMap.get(systemId) ?? 0) + delta);
  }

  const totals = Array.from(totalsMap.entries()).map(([system_id, qty]) => ({ system_id, qty }));

  const now = new Date().toISOString();
  const { error: participantError } = await supabase
    .from('inventory_session_participants')
    .update({ last_seen_at: now })
    .eq('session_id', input.session_id)
    .eq('participant_id', input.actor_id);

  if (participantError) {
    throw new Error(participantError.message);
  }

  const { error: sessionError } = await supabase
    .from('inventory_sessions')
    .update({ updated_at: now, last_sync_at: now })
    .eq('id', input.session_id);

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  return {
    inserted: input.events.length,
    totals,
    last_sync_at: now
  };
}

export async function getSessionState(
  supabase: SupabaseClient,
  sessionId: string
): Promise<InventorySessionState> {
  const { data: session, error: sessionError } = await supabase
    .from('inventory_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? 'Session not found');
  }

  const { data: participants, error: participantsError } = await supabase
    .from('inventory_session_participants')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true });

  if (participantsError) {
    throw new Error(participantsError.message);
  }

  const { data: events, error: eventsError } = await supabase
    .from('inventory_session_events')
    .select('actor_id,system_id,delta_qty')
    .eq('session_id', sessionId);

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  const totalsMap = new Map<string, number>();
  const contributionMap = new Map<string, number>();
  for (const row of events ?? []) {
    const systemId = normalizeIdentifier((row as { system_id: string }).system_id);
    const delta = Number((row as { delta_qty: number }).delta_qty) || 0;
    totalsMap.set(systemId, (totalsMap.get(systemId) ?? 0) + delta);
    const actorId = normalizeIdentifier((row as { actor_id: string }).actor_id);
    const contributionKey = `${actorId}::${systemId}`;
    contributionMap.set(contributionKey, (contributionMap.get(contributionKey) ?? 0) + delta);
  }

  return {
    session: session as InventorySession,
    participants: (participants ?? []) as InventorySessionState['participants'],
    totals: Array.from(totalsMap.entries()).map(([system_id, qty]) => ({ system_id, qty })),
    contributions: Array.from(contributionMap.entries()).map(([key, qty]) => {
      const [actor_id, system_id] = key.split('::');
      return { actor_id, system_id, qty };
    }),
    pending_event_count: (events ?? []).length,
    last_sync_at: (session.last_sync_at as string | null) ?? null
  };
}

export async function finalizeSession(
  supabase: SupabaseClient,
  input: { session_id: string; finalized_by: string; lock: boolean }
): Promise<{
  totals: InventoryItemTotal[];
  mismatches: Array<{ system_id: string; qty: number; previous_qty: number; delta: number }>;
}> {
  const state = await getSessionState(supabase, input.session_id);

  const { data: overrides, error: overrideError } = await supabase
    .from('inventory_manual_overrides')
    .select('system_id,override_qty')
    .eq('session_id', input.session_id);

  if (overrideError) {
    throw new Error(overrideError.message);
  }

  const totalsMap = new Map<string, number>();
  for (const total of state.totals) {
    totalsMap.set(total.system_id, total.qty);
  }

  for (const override of overrides ?? []) {
    totalsMap.set(
      normalizeIdentifier((override as { system_id: string }).system_id),
      Number((override as { override_qty: number }).override_qty) || 0
    );
  }

  const totals = Array.from(totalsMap.entries()).map(([system_id, qty]) => ({ system_id, qty }));

  if (totals.length > 0) {
    const upsertRows = totals.map((row) => ({
      session_id: input.session_id,
      system_id: row.system_id,
      final_qty: row.qty,
      finalized_by: input.finalized_by
    }));

    const { error: finalError } = await supabase
      .from('inventory_session_final')
      .upsert(upsertRows, { onConflict: 'session_id,system_id' });

    if (finalError) {
      throw new Error(finalError.message);
    }
  }

  const { data: previousSession, error: previousError } = await supabase
    .from('inventory_sessions')
    .select('id')
    .eq('status', 'locked')
    .neq('id', input.session_id)
    .order('locked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousError) {
    throw new Error(previousError.message);
  }

  const previousMap = new Map<string, number>();
  if (previousSession?.id) {
    const { data: previousRows, error: previousRowsError } = await supabase
      .from('inventory_session_final')
      .select('system_id,final_qty')
      .eq('session_id', previousSession.id as string);

    if (previousRowsError) {
      throw new Error(previousRowsError.message);
    }

    for (const row of previousRows ?? []) {
      previousMap.set(
        normalizeIdentifier((row as { system_id: string }).system_id),
        Number((row as { final_qty: number }).final_qty) || 0
      );
    }
  }

  const mismatches = totals
    .map((row) => {
      const previousQty = previousMap.get(row.system_id) ?? 0;
      return {
        system_id: row.system_id,
        qty: row.qty,
        previous_qty: previousQty,
        delta: row.qty - previousQty
      };
    })
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const now = new Date().toISOString();
  const nextStatus = input.lock ? 'locked' : 'finalizing';
  const { error: updateError } = await supabase
    .from('inventory_sessions')
    .update({
      status: nextStatus,
      locked_at: input.lock ? now : null,
      updated_at: now
    })
    .eq('id', input.session_id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    totals,
    mismatches
  };
}

export async function writeUploadRun(
  supabase: SupabaseClient,
  input: {
    session_id: string;
    triggered_by: string;
    count_name: string;
    shop_id: string;
    employee_id: string;
    reconcile: boolean;
    request_items: Array<{ system_id: string; qty: number }>;
    response_payload: InventoryUploadSummary;
    response_status: number;
  }
): Promise<void> {
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(input.request_items))
    .digest('hex');

  const { error } = await supabase.from('inventory_upload_runs').insert({
    session_id: input.session_id,
    triggered_by: input.triggered_by,
    count_name: input.count_name,
    shop_id: input.shop_id,
    employee_id: input.employee_id,
    reconcile: input.reconcile,
    request_item_count: input.request_items.length,
    request_payload_hash: requestHash,
    response_status: input.response_status,
    response_summary: input.response_payload,
    omitted_items_zeroed_warning: true
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getSessionFinalItems(
  supabase: SupabaseClient,
  sessionId: string
): Promise<Array<{ system_id: string; qty: number }>> {
  const { data, error } = await supabase
    .from('inventory_session_final')
    .select('system_id,final_qty')
    .eq('session_id', sessionId)
    .order('system_id', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    system_id: normalizeIdentifier((row as { system_id: string }).system_id),
    qty: Number((row as { final_qty: number }).final_qty) || 0
  }));
}
