'use client';

import { useEffect, useMemo, useState } from 'react';

import { BarcodeScanner } from '@/app/inventory/_components/barcode-scanner';
import { QRSyncPanel } from '@/app/inventory/_components/qr-sync-panel';
import { resolveCatalogItemByCode } from '@/lib/inventory/identifiers';
import {
  clearSessionLocalData,
  getPendingEvents,
  markEventsSynced,
  readSnapshot,
  saveLocalEvent,
  saveSnapshot
} from '@/lib/inventory/indexeddb';
import { InventoryCatalogItem, InventoryCountEvent, InventorySessionState } from '@/lib/inventory/types';
import { createQrPacket, encodeQrPacket, parseQrPacket, resolveSyncProvider } from '@/lib/inventory/sync';

const TABS = ['Catalog', 'Sessions', 'Count View', 'Finalize & Upload'] as const;
type TabId = (typeof TABS)[number];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store'
  });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || (payload && payload.ok === false)) {
    throw new Error((payload as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return payload;
}

function getOrCreateDeviceId() {
  if (typeof window === 'undefined') return 'device-server';
  const existing = localStorage.getItem('inventory_device_id');
  if (existing) return existing;
  const created = `device-${crypto.randomUUID()}`;
  localStorage.setItem('inventory_device_id', created);
  return created;
}

function nextEventId(deviceId: string): string {
  const key = `inventory_counter_${deviceId}`;
  const current = Number(localStorage.getItem(key) ?? '0') + 1;
  localStorage.setItem(key, String(current));
  return `${deviceId}:${current}`;
}

function aggregateTotals(events: InventoryCountEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    map.set(event.system_id, (map.get(event.system_id) ?? 0) + event.delta_qty);
  }
  return map;
}

export function InventoryDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('Catalog');
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogStatus, setCatalogStatus] = useState('');

  const [deviceId, setDeviceId] = useState('');
  const [actorName, setActorName] = useState('Counter');
  const [sessionId, setSessionId] = useState('');
  const [sessionName, setSessionName] = useState('Inventory Session');
  const [role, setRole] = useState<'host' | 'participant'>('host');
  const [sessionState, setSessionState] = useState<InventorySessionState | null>(null);
  const [sessionStatus, setSessionStatus] = useState('No active session.');

  const [scanInput, setScanInput] = useState('');
  const [manualSystemId, setManualSystemId] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingTotals, setPendingTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [snapshotTotals, setSnapshotTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [syncPreference, setSyncPreference] = useState<'ble' | 'qr'>('ble');
  const [syncStatus, setSyncStatus] = useState('');
  const [outgoingQrPacket, setOutgoingQrPacket] = useState('');

  const [finalizedTotals, setFinalizedTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [mismatches, setMismatches] = useState<
    Array<{ system_id: string; qty: number; previous_qty: number; delta: number }>
  >([]);
  const [uploadStatus, setUploadStatus] = useState('');

  const [online, setOnline] = useState(true);

  const [catalogForm, setCatalogForm] = useState({
    row_id: 0,
    system_id: '',
    item_name: '',
    upc: '',
    ean: '',
    custom_sku: '',
    manufact_sku: ''
  });

  const [uploadForm, setUploadForm] = useState({
    count_name: '',
    shop_id: '1',
    employee_id: '1',
    reconcile: true,
    rps: '0.3'
  });

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadCatalog = async () => {
    try {
      const payload = await fetchJson<{ ok: true; items: InventoryCatalogItem[] }>(
        `/api/inventory/catalog/list?q=${encodeURIComponent(catalogQuery.trim())}`
      );
      setCatalog(payload.items);
      setCatalogStatus(`Loaded ${payload.items.length} catalog items.`);
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : 'Failed to load catalog');
    }
  };

  const loadSessionState = async (id: string) => {
    if (!id) return;
    try {
      const payload = await fetchJson<{ ok: true; state: InventorySessionState }>(`/api/inventory/session/${id}/state`);
      setSessionState(payload.state);
      setSessionStatus(
        `Session ${payload.state.session.session_name} (${payload.state.session.status}) | Attendance: ${payload.state.participants.length}`
      );
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Unable to load session state');
    }
  };

  useEffect(() => {
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    loadSessionState(sessionId);

    const timer = window.setInterval(() => {
      if (navigator.onLine) {
        loadSessionState(sessionId);
      }
    }, 8000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const updatePending = async () => {
      const events = await getPendingEvents(sessionId);
      setPendingCount(events.length);
      const totals = aggregateTotals(events);
      setPendingTotals(Array.from(totals.entries()).map(([system_id, qty]) => ({ system_id, qty })));

      const snapshot = await readSnapshot(sessionId);
      setSnapshotTotals(snapshot?.totals ?? []);
    };
    updatePending();
  }, [sessionId, sessionState]);

  const displayedTotals = useMemo(() => {
    const server = new Map<string, number>();
    for (const row of sessionState?.totals ?? []) {
      server.set(row.system_id, row.qty);
    }
    const merged = new Map<string, number>(server);
    const baseRows = sessionState ? [] : snapshotTotals;
    for (const row of baseRows) {
      merged.set(row.system_id, row.qty);
    }
    for (const row of pendingTotals) {
      merged.set(row.system_id, (merged.get(row.system_id) ?? 0) + row.qty);
    }
    return merged;
  }, [pendingTotals, sessionState, snapshotTotals]);

  const countRows = useMemo(() => {
    const rows = Array.from(displayedTotals.entries()).map(([system_id, qty]) => {
      const catalogItem = catalog.find((item) => item.system_id === system_id);
      return {
        system_id,
        qty,
        item_name: catalogItem?.item_name ?? '(Unmatched item)',
        upc: catalogItem?.upc ?? ''
      };
    });

    return rows.sort((a, b) => b.qty - a.qty);
  }, [catalog, displayedTotals]);

  const contributionRows = useMemo(() => {
    const contributions = sessionState?.contributions ?? [];
    return contributions
      .map((entry) => {
        const participant = sessionState?.participants.find((row) => row.participant_id === entry.actor_id);
        const catalogItem = catalog.find((item) => item.system_id === entry.system_id);
        return {
          actor: participant?.display_name ?? entry.actor_id,
          actor_id: entry.actor_id,
          system_id: entry.system_id,
          item_name: catalogItem?.item_name ?? entry.system_id,
          qty: entry.qty
        };
      })
      .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
  }, [catalog, sessionState]);

  const appendEvent = async (systemId: string, delta: number) => {
    if (!sessionId) {
      setSyncStatus('Create or join a session first.');
      return;
    }
    if (!systemId.trim()) {
      setSyncStatus('System ID is required for count events.');
      return;
    }

    const event: InventoryCountEvent = {
      session_id: sessionId,
      event_id: nextEventId(deviceId),
      actor_id: deviceId,
      system_id: systemId.trim(),
      delta_qty: delta,
      timestamp: new Date().toISOString()
    };

    await saveLocalEvent(event);
    const events = await getPendingEvents(sessionId);
    setPendingCount(events.length);
    setSyncStatus(`Queued event ${event.event_id}. Pending sync: ${events.length}`);
  };

  const onScanValue = async (value: string) => {
    const resolved = resolveCatalogItemByCode(catalog, value);
    if (resolved.item) {
      await appendEvent(resolved.item.system_id, 1);
      setSyncStatus(`Matched ${resolved.key}: ${resolved.item.item_name}`);
      return;
    }

    setSyncStatus(`No catalog match for ${value}. Enter System ID manually.`);
  };

  const createSession = async () => {
    try {
      const payload = await fetchJson<{ ok: true; session: { id: string } }>('/api/inventory/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_name: sessionName,
          host_id: deviceId,
          host_name: actorName,
          created_by: 'open_access'
        })
      });
      setRole('host');
      setSessionId(payload.session.id);
      setSessionStatus(`Session created: ${payload.session.id}`);
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Failed to create session');
    }
  };

  const joinSession = async () => {
    if (!sessionId.trim()) {
      setSessionStatus('Enter a session ID.');
      return;
    }

    try {
      await fetchJson('/api/inventory/session/commit-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId.trim(),
          actor_id: deviceId,
          actor_name: actorName,
          events: []
        })
      });
      setSessionId(sessionId.trim());
      setSessionStatus(`Joined session ${sessionId.trim()}.`);
      await loadSessionState(sessionId.trim());
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Unable to join session');
    }
  };

  const syncNow = async () => {
    if (!sessionId) {
      setSyncStatus('No active session selected.');
      return;
    }

    const pendingEvents = await getPendingEvents(sessionId);
    if (!pendingEvents.length) {
      setSyncStatus('No pending local events.');
      if (online) await loadSessionState(sessionId);
      return;
    }

    const provider = resolveSyncProvider(syncPreference);

    if (provider.id === 'qr') {
      const packet = createQrPacket({
        context: {
          session_id: sessionId,
          actor_id: deviceId,
          actor_name: actorName,
          role
        },
        events: pendingEvents
      });
      setOutgoingQrPacket(packet);
      setSyncStatus('QR packet generated. Have host scan/import it.');
      return;
    }

    const bleResult = await provider.syncNow({
      context: {
        session_id: sessionId,
        actor_id: deviceId,
        actor_name: actorName,
        role
      },
      events: pendingEvents
    });

    if (!bleResult.ok) {
      const fallbackPacket = createQrPacket({
        context: {
          session_id: sessionId,
          actor_id: deviceId,
          actor_name: actorName,
          role
        },
        events: pendingEvents
      });
      setOutgoingQrPacket(fallbackPacket);
      setSyncStatus(`BLE failed (${bleResult.message}). QR fallback packet generated.`);
      return;
    }

    const commitPayload = await fetchJson<{
      ok: true;
      totals: Array<{ system_id: string; qty: number }>;
    }>('/api/inventory/session/commit-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        actor_id: deviceId,
        actor_name: actorName,
        events: pendingEvents
      })
    });

    await markEventsSynced(pendingEvents.map((event) => event.event_id));
    await saveSnapshot(sessionId, commitPayload.totals);
    setOutgoingQrPacket('');
    setSyncStatus('Sync complete and local pending events acknowledged.');
    await loadSessionState(sessionId);
  };

  const importQrPacket = async (packetText: string) => {
    if (!sessionId) {
      throw new Error('No active session.');
    }

    const packet = parseQrPacket(packetText);
    if (packet.session_id !== sessionId) {
      throw new Error('Packet belongs to a different session.');
    }

    if (role === 'host' && packet.events.length) {
      const response = await fetchJson<{ ok: true; totals: Array<{ system_id: string; qty: number }> }>(
        '/api/inventory/session/commit-events',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            actor_id: packet.actor_id,
            actor_name: `Peer ${packet.actor_id.slice(-4)}`,
            events: packet.events
          })
        }
      );

      const ackPacket = encodeQrPacket({
        session_id: sessionId,
        actor_id: deviceId,
        generated_at: new Date().toISOString(),
        events: [],
        totals: response.totals,
        ack_event_ids: packet.events.map((event) => event.event_id)
      });
      setOutgoingQrPacket(ackPacket);
      await loadSessionState(sessionId);
      setSyncStatus(`Imported ${packet.events.length} events from peer packet.`);
      return;
    }

    if (packet.totals?.length) {
      await saveSnapshot(sessionId, packet.totals);
    }

    if (packet.ack_event_ids?.length) {
      await markEventsSynced(packet.ack_event_ids);
      const pendingEvents = await getPendingEvents(sessionId);
      setPendingCount(pendingEvents.length);
      setSyncStatus(`Imported host ack packet. ${pendingEvents.length} pending events remain.`);
      return;
    }

    setSyncStatus('Packet imported.');
  };

  const finalizeSession = async (lock: boolean) => {
    if (!sessionId) {
      setUploadStatus('No session selected.');
      return;
    }

    try {
      const payload = await fetchJson<{
        ok: true;
        totals: Array<{ system_id: string; qty: number }>;
        mismatches: Array<{ system_id: string; qty: number; previous_qty: number; delta: number }>;
      }>('/api/inventory/session/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, finalized_by: deviceId, lock })
      });

      setFinalizedTotals(payload.totals);
      setMismatches(payload.mismatches);
      setUploadStatus(lock ? 'Session locked and finalized.' : 'Session moved to finalizing state.');
      await loadSessionState(sessionId);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Finalize failed');
    }
  };

  const exportFinal = (format: 'json' | 'csv') => {
    const rows = finalizedTotals.length ? finalizedTotals : countRows.map((row) => ({ system_id: row.system_id, qty: row.qty }));
    const now = new Date().toISOString().replace(/[:.]/g, '-');

    let content = '';
    let type = '';
    let extension = '';

    if (format === 'json') {
      content = JSON.stringify(rows, null, 2);
      type = 'application/json';
      extension = 'json';
    } else {
      content = ['system_id,qty', ...rows.map((row) => `${row.system_id},${row.qty}`)].join('\n');
      type = 'text/csv';
      extension = 'csv';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inventory-session-${sessionId}-${now}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const uploadToLightspeed = async () => {
    if (!sessionId) {
      setUploadStatus('No session selected.');
      return;
    }
    if (role !== 'host') {
      setUploadStatus('Only host can upload to R-Series.');
      return;
    }

    const confirmed = window.confirm(
      'Upload to R-Series now? Omitted items will be set to 0 by backend reconcile.'
    );
    if (!confirmed) return;

    try {
      const payload = await fetchJson<{ ok: boolean; warning: string; upstream: unknown }>(
        '/api/inventory/upload/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            triggered_by: deviceId,
            actor_role: role,
            count_name: uploadForm.count_name || `Inventory Session ${sessionId}`,
            shop_id: uploadForm.shop_id,
            employee_id: uploadForm.employee_id,
            reconcile: uploadForm.reconcile,
            rps: Number(uploadForm.rps)
          })
        }
      );

      setUploadStatus(`${payload.warning} Upload response: ${JSON.stringify(payload.upstream)}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  return (
    <main className="min-h-screen w-full p-4 md:p-6">
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-4">
          <h1 className="text-xl font-semibold text-neutral-900">Inventory Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-700">
            Offline-first counting with BLE burst sync and QR packet fallback.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={`border px-2 py-1 ${online ? 'border-emerald-700 text-emerald-700' : 'border-red-700 text-red-700'}`}>
              {online ? 'Online' : 'Offline'}
            </span>
            <span className="border border-neutral-400 px-2 py-1">Role: {role}</span>
            <span className="border border-neutral-400 px-2 py-1">Device: {deviceId || '...'}</span>
            <span className="border border-neutral-400 px-2 py-1">Pending events: {pendingCount}</span>
          </div>
        </header>

        <nav className="flex flex-wrap border-b border-neutral-300 bg-neutral-50">
          {TABS.map((tab) => (
            <button
              className={`border-r border-neutral-300 px-4 py-2 text-sm ${activeTab === tab ? 'bg-white font-semibold' : 'bg-neutral-50'}`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </nav>

        <section className="space-y-4 p-4">
          {activeTab === 'Catalog' ? (
            <section className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <input
                  className="min-w-64 border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search by item, UPC, EAN, System ID"
                  value={catalogQuery}
                />
                <button
                  className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white"
                  onClick={loadCatalog}
                  type="button"
                >
                  Search
                </button>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">CSV Drag-Drop Import (Catalog Only)</h3>
                <p className="mt-1 text-xs text-neutral-700">
                  Imports/updates metadata from `public.&quot;Inventory&quot;` columns. `Qty.` is ignored and never changes counts.
                </p>
                <input
                  accept=".csv,text/csv"
                  className="mt-2 text-xs"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;

                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                      const payload = await fetchJson<{ ok: true; imported: number }>(
                        '/api/inventory/catalog/import-csv',
                        {
                          method: 'POST',
                          body: formData
                        }
                      );
                      setCatalogStatus(`CSV import complete. ${payload.imported} rows processed.`);
                      await loadCatalog();
                    } catch (error) {
                      setCatalogStatus(error instanceof Error ? error.message : 'CSV import failed');
                    }
                  }}
                  type="file"
                />
              </div>

              <div className="grid gap-2 border border-neutral-300 p-3 md:grid-cols-2">
                <h3 className="md:col-span-2 text-sm font-semibold text-neutral-900">Manual Add / Edit Item</h3>
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, system_id: event.target.value }))}
                  placeholder="System ID (required)"
                  value={catalogForm.system_id}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, item_name: event.target.value }))}
                  placeholder="Item Name (required)"
                  value={catalogForm.item_name}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, upc: event.target.value }))}
                  placeholder="UPC"
                  value={catalogForm.upc}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, ean: event.target.value }))}
                  placeholder="EAN"
                  value={catalogForm.ean}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, custom_sku: event.target.value }))}
                  placeholder="Custom SKU"
                  value={catalogForm.custom_sku}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, manufact_sku: event.target.value }))}
                  placeholder="Manufact. SKU"
                  value={catalogForm.manufact_sku}
                />
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <button
                    className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
                    onClick={async () => {
                      try {
                        await fetchJson('/api/inventory/catalog/add', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'upsert',
                            item: {
                              row_id: catalogForm.row_id || undefined,
                              system_id: catalogForm.system_id,
                              item_name: catalogForm.item_name,
                              upc: catalogForm.upc,
                              ean: catalogForm.ean,
                              custom_sku: catalogForm.custom_sku,
                              manufact_sku: catalogForm.manufact_sku
                            }
                          })
                        });
                        setCatalogStatus('Catalog item saved.');
                        setCatalogForm({ row_id: 0, system_id: '', item_name: '', upc: '', ean: '', custom_sku: '', manufact_sku: '' });
                        await loadCatalog();
                      } catch (error) {
                        setCatalogStatus(error instanceof Error ? error.message : 'Save failed');
                      }
                    }}
                    type="button"
                  >
                    Save Item
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-neutral-300">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-neutral-100">
                    <tr>
                      <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Item</th>
                      <th className="border-b border-neutral-300 px-2 py-1">UPC</th>
                      <th className="border-b border-neutral-300 px-2 py-1">EAN</th>
                      <th className="border-b border-neutral-300 px-2 py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.slice(0, 300).map((item) => (
                      <tr key={item.row_id}>
                        <td className="border-b border-neutral-200 px-2 py-1">{item.system_id}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{item.item_name}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{item.upc}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{item.ean}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">
                          <div className="flex gap-2">
                            <button
                              className="border border-neutral-400 px-2 py-1"
                              onClick={() =>
                                setCatalogForm({
                                  row_id: item.row_id,
                                  system_id: item.system_id,
                                  item_name: item.item_name,
                                  upc: item.upc,
                                  ean: item.ean,
                                  custom_sku: item.custom_sku,
                                  manufact_sku: item.manufact_sku
                                })
                              }
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="border border-red-700 px-2 py-1 text-red-700"
                              onClick={async () => {
                                try {
                                  await fetchJson('/api/inventory/catalog/add', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'remove', row_id: item.row_id })
                                  });
                                  await loadCatalog();
                                  setCatalogStatus('Item removed (soft delete).');
                                } catch (error) {
                                  setCatalogStatus(error instanceof Error ? error.message : 'Delete failed');
                                }
                              }}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-neutral-700">{catalogStatus}</p>
            </section>
          ) : null}

          {activeTab === 'Sessions' ? (
            <section className="space-y-4">
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setActorName(event.target.value)}
                  placeholder="Display name"
                  value={actorName}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setSessionName(event.target.value)}
                  placeholder="Session name"
                  value={sessionName}
                />
                <select
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setRole(event.target.value as 'host' | 'participant')}
                  value={role}
                >
                  <option value="host">Host</option>
                  <option value="participant">Participant</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
                  onClick={createSession}
                  type="button"
                >
                  Create Session (Host)
                </button>
                <input
                  className="min-w-72 border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setSessionId(event.target.value)}
                  placeholder="Session ID"
                  value={sessionId}
                />
                <button
                  className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white"
                  onClick={joinSession}
                  type="button"
                >
                  Join Session
                </button>
                <button
                  className="border border-neutral-400 px-3 py-2 text-sm"
                  onClick={() => loadSessionState(sessionId)}
                  type="button"
                >
                  Refresh Attendance
                </button>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Attendance</h3>
                <p className="mt-1 text-xs text-neutral-700">{sessionStatus}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {(sessionState?.participants ?? []).map((participant) => (
                    <li className="border border-neutral-200 p-2" key={participant.id}>
                      {participant.display_name} ({participant.participant_id}) | last seen: {participant.last_seen_at}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Sync Status</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-neutral-700">
                    Provider
                    <select
                      className="ml-2 border border-neutral-300 px-2 py-1"
                      onChange={(event) => setSyncPreference(event.target.value as 'ble' | 'qr')}
                      value={syncPreference}
                    >
                      <option value="ble">BLE (Primary)</option>
                      <option value="qr">QR Packet (Fallback)</option>
                    </select>
                  </label>
                  <button
                    className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white"
                    onClick={syncNow}
                    type="button"
                  >
                    Sync Now
                  </button>
                </div>
                <p className="mt-2 text-xs text-neutral-700">{syncStatus}</p>
                <p className="mt-1 text-xs text-amber-700">
                  During counting, devices can remain offline. Step outside briefly to sync.
                </p>
              </div>
            </section>
          ) : null}

          {activeTab === 'Count View' ? (
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <section className="space-y-3">
                  <BarcodeScanner onDetected={onScanValue} />

                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Manual Scan Entry</h3>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="w-full border border-neutral-300 px-2 py-2 text-sm"
                        onChange={(event) => setScanInput(event.target.value)}
                        placeholder="Scan/enter UPC, EAN, System ID, Custom SKU, Manufact. SKU"
                        value={scanInput}
                      />
                      <button
                        className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
                        onClick={async () => {
                          await onScanValue(scanInput);
                          setScanInput('');
                        }}
                        type="button"
                      >
                        +1
                      </button>
                    </div>
                  </div>

                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Manual System ID Count</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className="min-w-64 border border-neutral-300 px-2 py-2 text-sm"
                        onChange={(event) => setManualSystemId(event.target.value)}
                        placeholder="System ID"
                        value={manualSystemId}
                      />
                      <button
                        className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white"
                        onClick={() => appendEvent(manualSystemId, 1)}
                        type="button"
                      >
                        Add +1
                      </button>
                      <button
                        className="border border-neutral-700 px-3 py-2 text-xs"
                        onClick={() => appendEvent(manualSystemId, -1)}
                        type="button"
                      >
                        Subtract -1
                      </button>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Per-Item Totals</h3>
                    <p className="mt-1 text-xs text-neutral-700">Offline indicator: {online ? 'Connected' : 'No network'}.</p>
                    <div className="mt-2 max-h-72 overflow-auto border border-neutral-200">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-neutral-100">
                          <tr>
                            <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Item</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countRows.map((row) => (
                            <tr key={row.system_id}>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.system_id}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.item_name}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Per-User Contributions</h3>
                    <div className="mt-2 max-h-64 overflow-auto border border-neutral-200">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-neutral-100">
                          <tr>
                            <th className="border-b border-neutral-300 px-2 py-1">User</th>
                            <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Item</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contributionRows.map((row, idx) => (
                            <tr key={`${row.actor_id}-${row.system_id}-${idx}`}>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.actor}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.system_id}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.item_name}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>

              <QRSyncPanel onImportPacket={importQrPacket} outgoingPacket={outgoingQrPacket} />
            </section>
          ) : null}

          {activeTab === 'Finalize & Upload' ? (
            <section className="space-y-4">
              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Finalize Session</h3>
                <p className="mt-1 text-xs text-neutral-700">
                  Finalize computes totals from events + host overrides. Lock prevents further changes.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="border border-neutral-700 px-3 py-2 text-xs"
                    onClick={() => finalizeSession(false)}
                    type="button"
                  >
                    Finalize (No Lock)
                  </button>
                  <button
                    className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-xs text-white"
                    onClick={() => finalizeSession(true)}
                    type="button"
                  >
                    Lock Session
                  </button>
                  <button className="border border-neutral-400 px-3 py-2 text-xs" onClick={() => exportFinal('csv')} type="button">
                    Export CSV
                  </button>
                  <button className="border border-neutral-400 px-3 py-2 text-xs" onClick={() => exportFinal('json')} type="button">
                    Export JSON
                  </button>
                </div>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Mismatch Report</h3>
                <p className="mt-1 text-xs text-neutral-700">Compared to previous locked session totals.</p>
                <div className="mt-2 max-h-64 overflow-auto border border-neutral-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-neutral-100">
                      <tr>
                        <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                        <th className="border-b border-neutral-300 px-2 py-1">Current Qty</th>
                        <th className="border-b border-neutral-300 px-2 py-1">Previous Qty</th>
                        <th className="border-b border-neutral-300 px-2 py-1">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map((row) => (
                        <tr key={row.system_id}>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.system_id}</td>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.qty}</td>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.previous_qty}</td>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-red-300 bg-red-50 p-3">
                <h3 className="text-sm font-semibold text-red-900">Upload to R-Series (Host Only)</h3>
                <p className="mt-1 text-xs text-red-800">
                  Warning: Omitted items will be set to 0 by backend reconcile.
                </p>

                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  <input
                    className="border border-red-300 bg-white px-2 py-2 text-xs"
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, count_name: event.target.value }))}
                    placeholder="Count name"
                    value={uploadForm.count_name}
                  />
                  <input
                    className="border border-red-300 bg-white px-2 py-2 text-xs"
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, shop_id: event.target.value }))}
                    placeholder="shop_id"
                    value={uploadForm.shop_id}
                  />
                  <input
                    className="border border-red-300 bg-white px-2 py-2 text-xs"
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, employee_id: event.target.value }))}
                    placeholder="employee_id"
                    value={uploadForm.employee_id}
                  />
                  <input
                    className="border border-red-300 bg-white px-2 py-2 text-xs"
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, rps: event.target.value }))}
                    placeholder="rps"
                    value={uploadForm.rps}
                  />
                </div>

                <label className="mt-2 flex items-center gap-2 text-xs text-red-900">
                  <input
                    checked={uploadForm.reconcile}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, reconcile: event.target.checked }))}
                    type="checkbox"
                  />
                  Reconcile upload (required for authoritative zero-out behavior)
                </label>

                <div className="mt-2 flex gap-2">
                  <button
                    className="border border-red-800 bg-red-800 px-3 py-2 text-xs text-white disabled:opacity-60"
                    disabled={role !== 'host'}
                    onClick={uploadToLightspeed}
                    type="button"
                  >
                    Upload to R-Series
                  </button>
                  <button
                    className="border border-neutral-400 px-3 py-2 text-xs"
                    onClick={async () => {
                      if (!sessionId) return;
                      await clearSessionLocalData(sessionId);
                      setPendingCount(0);
                      setSyncStatus('Cleared local cache for this session.');
                    }}
                    type="button"
                  >
                    Clear Local Offline Cache
                  </button>
                </div>
              </div>

              <p className="text-xs text-neutral-700">{uploadStatus}</p>
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
