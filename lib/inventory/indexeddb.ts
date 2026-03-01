'use client';

import { openDB } from 'idb';

import { InventoryCountEvent } from '@/lib/inventory/types';

const DB_NAME = 'coop_inventory_v1';

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('events')) {
        const events = database.createObjectStore('events', { keyPath: 'event_id' });
        events.createIndex('by-session', 'session_id');
        events.createIndex('by-session-sync', ['session_id', 'synced']);
      }

      if (!database.objectStoreNames.contains('snapshots')) {
        database.createObjectStore('snapshots', { keyPath: 'session_id' });
      }

      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta');
      }
    }
  });
}

export async function saveLocalEvent(event: InventoryCountEvent): Promise<void> {
  const database = await db();
  await database.put('events', { ...event, synced: 0 });
}

export async function getSessionEvents(sessionId: string): Promise<Array<InventoryCountEvent & { synced: number }>> {
  const database = await db();
  return database.getAllFromIndex('events', 'by-session', sessionId);
}

export async function getPendingEvents(sessionId: string): Promise<InventoryCountEvent[]> {
  const database = await db();
  const rows = await database.getAllFromIndex('events', 'by-session-sync', [sessionId, 0]);
  return rows.map((row) => ({
    session_id: row.session_id,
    event_id: row.event_id,
    actor_id: row.actor_id,
    system_id: row.system_id,
    delta_qty: row.delta_qty,
    timestamp: row.timestamp
  }));
}

export async function markEventsSynced(eventIds: string[]): Promise<void> {
  if (!eventIds.length) return;
  const database = await db();
  const tx = database.transaction('events', 'readwrite');
  for (const eventId of eventIds) {
    const existing = await tx.store.get(eventId);
    if (!existing) continue;
    await tx.store.put({ ...existing, synced: 1 });
  }
  await tx.done;
}

export async function saveSnapshot(
  session_id: string,
  totals: Array<{ system_id: string; qty: number }>
): Promise<void> {
  const database = await db();
  await database.put('snapshots', {
    session_id,
    totals,
    updated_at: new Date().toISOString()
  });
}

export async function readSnapshot(session_id: string): Promise<{
  session_id: string;
  totals: Array<{ system_id: string; qty: number }>;
  updated_at: string;
} | null> {
  const database = await db();
  return (await database.get('snapshots', session_id)) ?? null;
}

export async function clearSessionLocalData(sessionId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['events', 'snapshots'], 'readwrite');
  const eventStore = tx.objectStore('events');
  const events = await eventStore.index('by-session').getAll(sessionId);
  for (const event of events) {
    await eventStore.delete(event.event_id);
  }
  await tx.objectStore('snapshots').delete(sessionId);
  await tx.done;
}
