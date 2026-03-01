import { SyncProvider, SyncResult } from './types';

const SERVICE_UUID = '2f9fb7e0-7f34-4c1a-a88c-0da3d05bb9b7';
const PUSH_CHAR_UUID = '2f9fb7e1-7f34-4c1a-a88c-0da3d05bb9b7';
const SNAPSHOT_CHAR_UUID = '2f9fb7e2-7f34-4c1a-a88c-0da3d05bb9b7';

function chunkString(value: string, size = 180): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks;
}

export class BLEProvider implements SyncProvider {
  readonly id = 'ble' as const;

  isSupported(): boolean {
    const nav = navigator as Navigator & { bluetooth?: { requestDevice: (options: unknown) => Promise<any> } };
    return typeof navigator !== 'undefined' && Boolean(nav.bluetooth);
  }

  async syncNow(input: {
    context: { session_id: string; actor_id: string; actor_name: string; role: 'host' | 'participant' };
    events: Array<{
      session_id: string;
      event_id: string;
      actor_id: string;
      system_id: string;
      delta_qty: number;
      timestamp: string;
    }>;
  }): Promise<SyncResult> {
    if (!this.isSupported()) {
      return {
        ok: false,
        provider: 'ble',
        synced_event_ids: [],
        imported_events: 0,
        message: 'Web Bluetooth is unavailable on this browser.'
      };
    }

    if (input.context.role === 'host') {
      return {
        ok: false,
        provider: 'ble',
        synced_event_ids: [],
        imported_events: 0,
        message:
          'Host peripheral advertising is not reliable in mobile web. Use QR fallback or participant->host BLE if available.'
      };
    }

    try {
      const nav = navigator as Navigator & { bluetooth?: { requestDevice: (options: unknown) => Promise<any> } };
      if (!nav.bluetooth) {
        throw new Error('Web Bluetooth is unavailable on this browser.');
      }

      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Unable to connect to host BLE device.');
      }

      const service = await server.getPrimaryService(SERVICE_UUID);
      const push = await service.getCharacteristic(PUSH_CHAR_UUID);
      const snapshot = await service.getCharacteristic(SNAPSHOT_CHAR_UUID);

      const payload = JSON.stringify({
        session_id: input.context.session_id,
        actor_id: input.context.actor_id,
        events: input.events
      });

      const encoder = new TextEncoder();
      const chunks = chunkString(payload);
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkPayload = JSON.stringify({
          type: 'event_batch_chunk',
          index: i,
          total: chunks.length,
          chunk: chunks[i]
        });

        await push.writeValueWithResponse(encoder.encode(chunkPayload));
      }

      let snapshotTotals: Array<{ system_id: string; qty: number }> | undefined;
      try {
        const snapshotValue = await snapshot.readValue();
        const decoded = new TextDecoder().decode(snapshotValue.buffer);
        const parsed = JSON.parse(decoded) as { totals?: Array<{ system_id: string; qty: number }> };
        snapshotTotals = parsed.totals;
      } catch {
        snapshotTotals = undefined;
      }

      server.disconnect();

      return {
        ok: true,
        provider: 'ble',
        synced_event_ids: input.events.map((event) => event.event_id),
        imported_events: input.events.length,
        snapshot: snapshotTotals,
        message: 'BLE burst sync completed.'
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'ble',
        synced_event_ids: [],
        imported_events: 0,
        message: error instanceof Error ? error.message : 'BLE sync failed.'
      };
    }
  }
}
