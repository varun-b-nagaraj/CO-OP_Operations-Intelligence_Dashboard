import { InventoryCountEvent } from '@/lib/inventory/types';

import { SyncPacket, SyncProvider, SyncResult, SyncSessionContext } from './types';

export interface SessionJoinPacket {
  type: 'session_join';
  session_id: string;
  session_name?: string;
  host_id?: string;
  generated_at: string;
}

function encodeBase64Url(value: string): string {
  if (typeof window !== 'undefined') {
    return btoa(unescape(encodeURIComponent(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  if (typeof window !== 'undefined') {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  }

  return Buffer.from(value, 'base64url').toString('utf8');
}

export function encodeQrPacket(packet: SyncPacket): string {
  return encodeBase64Url(JSON.stringify(packet));
}

export function createSessionJoinPacket(input: {
  session_id: string;
  session_name?: string;
  host_id?: string;
}): string {
  const packet: SessionJoinPacket = {
    type: 'session_join',
    session_id: input.session_id,
    session_name: input.session_name,
    host_id: input.host_id,
    generated_at: new Date().toISOString()
  };
  return `coop-inv-join:${encodeBase64Url(JSON.stringify(packet))}`;
}

export function parseSessionJoinPacket(value: string): SessionJoinPacket {
  const raw = value.startsWith('coop-inv-join:') ? value.slice('coop-inv-join:'.length) : value;
  const parsed = JSON.parse(decodeBase64Url(raw)) as SessionJoinPacket;
  if (parsed.type !== 'session_join' || !parsed.session_id) {
    throw new Error('Invalid session join QR packet.');
  }
  return parsed;
}

export function createQrPacket(input: { context: SyncSessionContext; events: InventoryCountEvent[] }): string {
  const packet: SyncPacket = {
    session_id: input.context.session_id,
    actor_id: input.context.actor_id,
    generated_at: new Date().toISOString(),
    events: input.events
  };

  return encodeQrPacket(packet);
}

export function parseQrPacket(encoded: string): SyncPacket {
  const parsed = JSON.parse(decodeBase64Url(encoded)) as SyncPacket;
  if (!parsed.session_id || !parsed.actor_id) {
    throw new Error('Invalid QR sync packet');
  }
  if (!Array.isArray(parsed.events)) {
    parsed.events = [];
  }
  return parsed;
}

export class QRProvider implements SyncProvider {
  readonly id = 'qr' as const;

  isSupported(): boolean {
    return true;
  }

  async syncNow(input: { context: SyncSessionContext; events: InventoryCountEvent[] }): Promise<SyncResult> {
    const packet = createQrPacket(input);
    return {
      ok: true,
      provider: 'qr',
      synced_event_ids: input.events.map((event) => event.event_id),
      imported_events: input.events.length,
      message: packet
    };
  }
}
