export type InventorySessionStatus = 'active' | 'finalizing' | 'locked';

export interface InventoryCatalogItem {
  row_id: number;
  system_id: string;
  upc: string;
  ean: string;
  custom_sku: string;
  manufact_sku: string;
  item_name: string;
  vendor_id: string;
  price: string;
  tax: string;
  brand: string;
  publish_to_ecom: string;
  season: string;
  department: string;
  msrp: string;
  tax_class: string;
  default_cost: number | null;
  vendor: string;
  category: string;
  subcategory_1: string;
  subcategory_2: string;
  subcategory_3: string;
  subcategory_4: string;
  subcategory_5: string;
  subcategory_6: string;
  subcategory_7: string;
  subcategory_8: string;
  subcategory_9: string;
  deleted: boolean;
  updated_at: string | null;
}

export interface InventoryCountEvent {
  session_id: string;
  event_id: string;
  actor_id: string;
  system_id: string;
  delta_qty: number;
  timestamp: string;
}

export interface InventoryParticipant {
  id: string;
  session_id: string;
  participant_id: string;
  display_name: string;
  joined_at: string;
  last_seen_at: string;
  event_count: number;
}

export interface InventorySession {
  id: string;
  session_name: string;
  host_id: string;
  created_by: string;
  status: InventorySessionStatus;
  baseline_session_id: string | null;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
}

export interface InventoryItemTotal {
  system_id: string;
  qty: number;
}

export interface InventorySessionState {
  session: InventorySession;
  participants: InventoryParticipant[];
  totals: InventoryItemTotal[];
  contributions: Array<{ actor_id: string; system_id: string; qty: number }>;
  pending_event_count: number;
  last_sync_at: string | null;
}

export interface InventoryUploadSummary {
  ok: boolean;
  inventory_count_id?: string;
  inventory_count_name?: string;
  summary?: {
    total_rows?: number;
    created?: number;
    not_found?: number;
    failed?: number;
    invalid?: number;
  };
  reconcile?: {
    attempted?: boolean;
    ok?: boolean;
    message?: string;
  };
  [key: string]: unknown;
}

export interface CatalogUpsertInput {
  row_id?: number;
  system_id: string;
  item_name: string;
  upc?: string;
  ean?: string;
  custom_sku?: string;
  manufact_sku?: string;
  vendor_id?: string;
  price?: string;
  tax?: string;
  brand?: string;
  publish_to_ecom?: string;
  season?: string;
  department?: string;
  msrp?: string;
  tax_class?: string;
  default_cost?: number | null;
  vendor?: string;
  category?: string;
  subcategory_1?: string;
  subcategory_2?: string;
  subcategory_3?: string;
  subcategory_4?: string;
  subcategory_5?: string;
  subcategory_6?: string;
  subcategory_7?: string;
  subcategory_8?: string;
  subcategory_9?: string;
}
