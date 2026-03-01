import { InventoryCountEvent } from '@/lib/inventory/types';

export interface SyncSessionContext {
  session_id: string;
  actor_id: string;
  actor_name: string;
  role: 'host' | 'participant';
}

export interface SyncPacket {
  session_id: string;
  actor_id: string;
  generated_at: string;
  events: InventoryCountEvent[];
  totals?: Array<{ system_id: string; qty: number }>;
  ack_event_ids?: string[];
}

export interface SyncResult {
  ok: boolean;
  provider: 'ble' | 'qr';
  synced_event_ids: string[];
  imported_events: number;
  snapshot?: Array<{ system_id: string; qty: number }>;
  message?: string;
}

export interface SyncProvider {
  readonly id: 'ble' | 'qr';
  isSupported(): boolean;
  syncNow(input: { context: SyncSessionContext; events: InventoryCountEvent[] }): Promise<SyncResult>;
}
