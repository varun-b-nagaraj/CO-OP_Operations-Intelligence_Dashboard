'use client';

import jsQR from 'jsqr';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BarcodeScanner } from '@/app/inventory/_components/barcode-scanner';
import { resolveCatalogItemByCode } from '@/lib/inventory/identifiers';
import {
  clearSessionLocalData,
  getPendingEvents,
  getSessionEvents,
  markEventsSynced,
  readCatalogSnapshot,
  readSnapshot,
  saveCatalogSnapshot,
  saveLocalEvent,
  saveSnapshot
} from '@/lib/inventory/indexeddb';
import { InventoryCatalogItem, InventoryCountEvent } from '@/lib/inventory/types';
import { createSessionJoinPacket, parseSessionJoinPacket } from '@/lib/inventory/sync';

const TABS = ['Catalog', 'Sessions', 'Count View', 'Finalize & Upload'] as const;
type TabId = (typeof TABS)[number];
type FinalAction = 'none' | 'finalize' | 'lock';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store'
  });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
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
  const [sessionStatus, setSessionStatus] = useState('No active session.');

  const [activeScannedCode, setActiveScannedCode] = useState('');
  const [activeItem, setActiveItem] = useState<InventoryCatalogItem | null>(null);
  const [lookupCandidates, setLookupCandidates] = useState<InventoryCatalogItem[]>([]);
  const [lookupStatus, setLookupStatus] = useState('');
  const [qtyDraftBySystemId, setQtyDraftBySystemId] = useState<Record<string, string>>({});

  const [pendingCount, setPendingCount] = useState(0);
  const [pendingTotals, setPendingTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [snapshotTotals, setSnapshotTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [serverTotals, setServerTotals] = useState<Array<{ system_id: string; qty: number }>>([]);

  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const [hostJoinQr, setHostJoinQr] = useState('');
  const [scanJoinActive, setScanJoinActive] = useState(false);
  const [scanJoinStatus, setScanJoinStatus] = useState('');
  const joinScanVideoRef = useRef<HTMLVideoElement | null>(null);
  const joinScanCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [finalizedTotals, setFinalizedTotals] = useState<Array<{ system_id: string; qty: number }>>([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [finalAction, setFinalAction] = useState<FinalAction>('none');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [oauthStatus, setOauthStatus] = useState('');
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState('');

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

  const refreshPendingState = async (sid: string) => {
    const pendingEvents = await getPendingEvents(sid);
    setPendingCount(pendingEvents.length);

    const pendingMap = aggregateTotals(pendingEvents);
    setPendingTotals(Array.from(pendingMap.entries()).map(([system_id, qty]) => ({ system_id, qty })));

    const localSnapshot = await readSnapshot(sid);
    setSnapshotTotals(localSnapshot?.totals ?? []);
  };

  const cacheCatalogLocally = async () => {
    try {
      if (navigator.onLine) {
        const payload = await fetchJson<{ ok: true; items: InventoryCatalogItem[] }>('/api/inventory/catalog/list');
        await saveCatalogSnapshot(payload.items);
        return payload.items;
      }
    } catch {
      // fallback to cached snapshot below
    }

    return readCatalogSnapshot() as Promise<InventoryCatalogItem[]>;
  };

  const loadCatalog = async () => {
    const allItems = await cacheCatalogLocally();
    const q = catalogQuery.trim().toLowerCase();

    const filtered = q
      ? allItems.filter((item) => {
          return [item.item_name, item.system_id, item.upc, item.ean, item.custom_sku, item.manufact_sku]
            .join(' ')
            .toLowerCase()
            .includes(q);
        })
      : allItems;

    setCatalog(filtered);
    setCatalogStatus(`Catalog cached locally (${allItems.length} total items).`);
  };

  const loadSessionState = async (sid: string) => {
    if (!sid) return;
    try {
      const payload = await fetchJson<{
        ok: true;
        state: {
          session: { session_name: string; status: string };
          participants: unknown[];
          totals?: Array<{ system_id: string; qty: number }>;
        };
      }>(`/api/inventory/session/${sid}/state`);

      setSessionStatus(
        `Session ${payload.state.session.session_name} (${payload.state.session.status}) | Attendance: ${payload.state.participants.length}`
      );
      setServerTotals(payload.state.totals ?? []);
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Unable to load session state');
    }
  };

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void loadSessionState(sessionId);
    void refreshPendingState(sessionId);

    const timer = window.setInterval(() => {
      if (navigator.onLine) {
        void loadSessionState(sessionId);
      }
    }, 7000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const buildHostQr = async () => {
      if (role !== 'host' || !sessionId) {
        setHostJoinQr('');
        return;
      }
      const packet = createSessionJoinPacket({
        session_id: sessionId,
        session_name: sessionName,
        host_id: deviceId
      });
      const url = await QRCode.toDataURL(packet, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'L'
      });
      setHostJoinQr(url);
    };

    void buildHostQr();
  }, [deviceId, role, sessionId, sessionName]);

  useEffect(() => {
    if (!scanJoinActive) return;

    let stream: MediaStream | null = null;
    let timer: number | null = null;

    const runScan = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (!joinScanVideoRef.current || !joinScanCanvasRef.current) return;
        joinScanVideoRef.current.srcObject = stream;
        await joinScanVideoRef.current.play();

        timer = window.setInterval(async () => {
          if (!joinScanVideoRef.current || !joinScanCanvasRef.current) return;

          const video = joinScanVideoRef.current;
          const canvas = joinScanCanvasRef.current;
          if (!video.videoWidth || !video.videoHeight) return;

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) return;

          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imageData.data, imageData.width, imageData.height);
          if (!decoded?.data) return;

          try {
            const packet = parseSessionJoinPacket(decoded.data);
            await fetchJson('/api/inventory/session/commit-events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: packet.session_id,
                actor_id: deviceId,
                actor_name: actorName,
                events: []
              })
            });

            setSessionId(packet.session_id);
            await cacheCatalogLocally();
            await loadSessionState(packet.session_id);
            await refreshPendingState(packet.session_id);
            setScanJoinStatus(`Joined session ${packet.session_id}.`);
            setScanJoinActive(false);
          } catch (error) {
            setScanJoinStatus(error instanceof Error ? error.message : 'Invalid host QR');
          }
        }, 350);
      } catch (error) {
        setScanJoinStatus(error instanceof Error ? error.message : 'Unable to scan join QR');
        setScanJoinActive(false);
      }
    };

    void runScan();

    return () => {
      if (timer) window.clearInterval(timer);
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, [actorName, deviceId, scanJoinActive]);

  const displayedTotals = useMemo(() => {
    const merged = new Map<string, number>();
    for (const row of serverTotals) {
      merged.set(row.system_id, row.qty);
    }
    for (const row of snapshotTotals) {
      merged.set(row.system_id, row.qty);
    }
    for (const row of pendingTotals) {
      merged.set(row.system_id, (merged.get(row.system_id) ?? 0) + row.qty);
    }
    return merged;
  }, [pendingTotals, serverTotals, snapshotTotals]);

  const countRows = useMemo(() => {
    return Array.from(displayedTotals.entries())
      .map(([system_id, qty]) => {
        const item = catalog.find((entry) => entry.system_id === system_id);
        return {
          system_id,
          qty,
          item_name: item?.item_name ?? '(Unmatched item)'
        };
      })
      .sort((a, b) => b.qty - a.qty);
  }, [catalog, displayedTotals]);

  const uploadRows = useMemo(() => {
    if (finalizedTotals.length) return finalizedTotals;
    return countRows.map((row) => ({ system_id: row.system_id, qty: row.qty }));
  }, [countRows, finalizedTotals]);

  const appendEvent = async (systemId: string, deltaQty: number) => {
    if (!sessionId) {
      setSyncStatus('Join or create a session first.');
      return;
    }

    const event: InventoryCountEvent = {
      session_id: sessionId,
      event_id: nextEventId(deviceId),
      actor_id: deviceId,
      system_id: systemId,
      delta_qty: deltaQty,
      timestamp: new Date().toISOString()
    };

    await saveLocalEvent(event);
    await refreshPendingState(sessionId);
  };

  const onScanValue = async (value: string) => {
    setActiveScannedCode(value);
    const resolved = resolveCatalogItemByCode(catalog, value);
    if (!resolved.item) {
      setActiveItem(null);
      const normalized = value.trim().toLowerCase();
      const localCandidates = catalog
        .filter((item) =>
          [item.item_name, item.system_id, item.upc, item.ean, item.custom_sku, item.manufact_sku]
            .join(' ')
            .toLowerCase()
            .includes(normalized)
        )
        .slice(0, 8);

      let backendCandidates: InventoryCatalogItem[] = [];
      if (online) {
        try {
          const payload = await fetchJson<{ ok: true; items: InventoryCatalogItem[] }>(
            `/api/inventory/catalog/list?q=${encodeURIComponent(value)}`
          );
          backendCandidates = payload.items.slice(0, 8);
        } catch {
          backendCandidates = [];
        }
      }

      const mergedMap = new Map<number, InventoryCatalogItem>();
      for (const item of [...localCandidates, ...backendCandidates]) {
        mergedMap.set(item.row_id, item);
      }
      const merged = Array.from(mergedMap.values());
      setLookupCandidates(merged);

      if (merged.length === 1) {
        setActiveItem(merged[0]);
        await appendEvent(merged[0].system_id, 1);
        setLookupStatus(`No direct barcode match. Auto-matched ${merged[0].item_name} and added +1.`);
        setSyncStatus(`No direct barcode match. Auto-matched ${merged[0].item_name}.`);
        return;
      }

      setLookupStatus(
        merged.length
          ? `No direct barcode match. Pick the correct item below (${merged.length} candidates).`
          : `No match found for ${value}.`
      );
      setSyncStatus(`No direct barcode match for ${value}.`);
      return;
    }

    setLookupCandidates([]);
    setLookupStatus('');
    setActiveItem(resolved.item);
    await appendEvent(resolved.item.system_id, 1);
    setSyncStatus(`Scanned ${resolved.item.item_name}. +1 added.`);
  };

  const applyAbsoluteQty = async (systemId: string) => {
    const draft = qtyDraftBySystemId[systemId];
    const target = Number(draft);
    if (!Number.isFinite(target)) {
      setSyncStatus('Enter a valid number before applying qty.');
      return;
    }

    const current = displayedTotals.get(systemId) ?? 0;
    const delta = Math.trunc(target) - current;
    if (delta === 0) {
      setSyncStatus('Qty unchanged.');
      return;
    }

    await appendEvent(systemId, delta);
    setSyncStatus(`Set ${systemId} from ${current} to ${Math.trunc(target)}.`);
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
      await cacheCatalogLocally();
      await loadSessionState(payload.session.id);
      await refreshPendingState(payload.session.id);
      setSessionStatus(`Session created: ${payload.session.id}.`);
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Failed to create session');
    }
  };

  const joinSessionById = async (sid: string) => {
    const target = sid.trim();
    if (!target) {
      setSessionStatus('Enter a session ID');
      return;
    }

    try {
      await fetchJson('/api/inventory/session/commit-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: target,
          actor_id: deviceId,
          actor_name: actorName,
          events: []
        })
      });

      setSessionId(target);
      await cacheCatalogLocally();
      await loadSessionState(target);
      await refreshPendingState(target);
      setSessionStatus(`Joined session ${target}.`);
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : 'Unable to join session');
    }
  };

  const pushPendingEventsToBackend = async () => {
    if (!sessionId) throw new Error('No active session');

    const pendingEvents = await getPendingEvents(sessionId);
    if (!pendingEvents.length) {
      return { totals: serverTotals, sent: 0 };
    }

    const payload = await fetchJson<{ ok: true; totals: Array<{ system_id: string; qty: number }> }>(
      '/api/inventory/session/commit-events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          actor_id: deviceId,
          actor_name: actorName,
          events: pendingEvents
        })
      }
    );

    await markEventsSynced(pendingEvents.map((event) => event.event_id));
    await saveSnapshot(sessionId, payload.totals);
    setServerTotals(payload.totals);
    await refreshPendingState(sessionId);
    return { totals: payload.totals, sent: pendingEvents.length };
  };

  const syncNow = async () => {
    if (isSyncing) return;
    if (!sessionId) {
      setSyncStatus('No active session selected');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await pushPendingEventsToBackend();
      await loadSessionState(sessionId);
      setSyncStatus(result.sent > 0 ? `Synced ${result.sent} events to backend.` : 'No pending local events to sync.');
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const commitLocalEventsToServer = async () => {
    if (!sessionId) throw new Error('No active session');

    const localEvents = await getSessionEvents(sessionId);
    if (!localEvents.length) {
      return { totals: snapshotTotals };
    }

    const payload = await fetchJson<{ ok: true; totals: Array<{ system_id: string; qty: number }> }>(
      '/api/inventory/session/commit-events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          actor_id: deviceId,
          actor_name: actorName,
          events: localEvents.map((row) => ({
            session_id: row.session_id,
            event_id: row.event_id,
            actor_id: row.actor_id,
            system_id: row.system_id,
            delta_qty: row.delta_qty,
            timestamp: row.timestamp
          }))
        })
      }
    );

    await markEventsSynced(localEvents.map((row) => row.event_id));
    await saveSnapshot(sessionId, payload.totals);
    setServerTotals(payload.totals);
    await refreshPendingState(sessionId);
    await loadSessionState(sessionId);
    return payload;
  };

  const endSession = async () => {
    if (role !== 'host') {
      setUploadStatus('Only host can end the session');
      return;
    }
    if (!sessionId) {
      setUploadStatus('No session selected');
      return;
    }

    setIsEndingSession(true);
    try {
      await commitLocalEventsToServer();
      await fetchJson('/api/inventory/session/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, finalized_by: deviceId, lock: false })
      });
      await loadSessionState(sessionId);
      setUploadStatus('Session ended and committed to backend.');
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Unable to end session');
    } finally {
      setIsEndingSession(false);
    }
  };

  const finalizeSession = async (lock: boolean) => {
    if (!sessionId) {
      setUploadStatus('No session selected');
      return;
    }

    setIsFinalizing(true);
    setFinalAction(lock ? 'lock' : 'finalize');

    try {
      const committed = await commitLocalEventsToServer();
      const payload = await fetchJson<{ ok: true; totals: Array<{ system_id: string; qty: number }> }>(
        '/api/inventory/session/finalize',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, finalized_by: deviceId, lock })
        }
      );

      setFinalizedTotals(payload.totals.length ? payload.totals : committed.totals);
      await loadSessionState(sessionId);
      setUploadStatus(lock ? 'Session locked.' : 'Session set to finalizing.');
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Finalize action failed');
    } finally {
      setIsFinalizing(false);
    }
  };

  const exportFinal = (format: 'csv' | 'json') => {
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const content =
      format === 'json'
        ? JSON.stringify(uploadRows, null, 2)
        : ['system_id,qty', ...uploadRows.map((row) => `${row.system_id},${row.qty}`)].join('\n');

    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/csv'
    });

    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `inventory-${sessionId || 'session'}-${now}.${format}`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const startOauth = async () => {
    try {
      const payload = await fetchJson<{ ok: boolean; authorize_url?: string; instructions?: string }>(
        '/api/inventory/upload/start-oauth'
      );
      if (!payload.authorize_url) {
        throw new Error('OAuth start response missing authorize_url');
      }

      setOauthAuthorizeUrl(payload.authorize_url);
      const popup = window.open(payload.authorize_url, '_blank', 'noopener,noreferrer');
      if (popup) {
        setOauthStatus(
          payload.instructions ??
            'OAuth opened in a new tab. Complete Lightspeed login + 2FA there, then return and run upload.'
        );
      } else {
        setOauthStatus(
          'Popup blocked. Use Open authorize_url below, complete login + 2FA, then return and run upload.'
        );
      }
    } catch (error) {
      setOauthStatus(error instanceof Error ? error.message : 'Unable to start OAuth');
    }
  };

  const uploadToLightspeed = async () => {
    if (!sessionId) {
      setUploadStatus('No session selected');
      return;
    }
    if (role !== 'host') {
      setUploadStatus('Only host can upload to R-Series');
      return;
    }
    if (!uploadRows.length) {
      setUploadStatus('No counted items available for upload');
      return;
    }

    const confirmed = window.confirm(
      'Upload current totals now? Omitted items will be set to 0 by backend reconcile.'
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
            reconcile: true,
            items: uploadRows
          })
        }
      );

      setUploadStatus(`${payload.warning} Upload response: ${JSON.stringify(payload.upstream)}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  return (
    <main className="min-h-screen w-full p-2 sm:p-4 md:p-6">
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-3 sm:p-4">
          <h1 className="text-lg font-semibold text-neutral-900 sm:text-xl">Inventory Dashboard</h1>
          <p className="mt-1 text-xs text-neutral-700 sm:text-sm">
            Sync pushes local phone counts to backend for this active session. Host sees only this session totals.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`border px-2 py-1 ${online ? 'border-emerald-700 text-emerald-700' : 'border-red-700 text-red-700'}`}>
              {online ? 'Online' : 'Offline'}
            </span>
            <span className="border border-neutral-400 px-2 py-1">Role: {role}</span>
            <span className="border border-neutral-400 px-2 py-1">Pending events: {pendingCount}</span>
          </div>
        </header>

        <nav className="overflow-x-auto border-b border-neutral-300 bg-neutral-50">
          <div className="flex min-w-max">
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
          </div>
        </nav>

        <section className="space-y-3 p-3 sm:space-y-4 sm:p-4">
          {activeTab === 'Catalog' ? (
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search by item, UPC, EAN, System ID"
                  value={catalogQuery}
                />
                <button
                  className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white"
                  onClick={() => {
                    void loadCatalog();
                  }}
                  type="button"
                >
                  Search
                </button>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">CSV Import (Catalog Metadata)</h3>
                <input
                  accept=".csv,text/csv"
                  className="mt-2 text-xs"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;

                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                      const payload = await fetchJson<{ ok: true; imported: number }>('/api/inventory/catalog/import-csv', {
                        method: 'POST',
                        body: formData
                      });
                      setCatalogStatus(`CSV import complete. ${payload.imported} rows processed.`);
                      await loadCatalog();
                    } catch (error) {
                      setCatalogStatus(error instanceof Error ? error.message : 'CSV import failed');
                    }
                  }}
                  type="file"
                />
              </div>

              <div className="grid gap-2 border border-neutral-300 p-3 sm:grid-cols-2">
                <h3 className="sm:col-span-2 text-sm font-semibold text-neutral-900">Manual Add / Edit Item</h3>
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, system_id: event.target.value }))}
                  placeholder="System ID"
                  value={catalogForm.system_id}
                />
                <input
                  className="border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, item_name: event.target.value }))}
                  placeholder="Item Name"
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

                <button
                  className="sm:col-span-2 border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
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
                      setCatalogForm({
                        row_id: 0,
                        system_id: '',
                        item_name: '',
                        upc: '',
                        ean: '',
                        custom_sku: '',
                        manufact_sku: ''
                      });
                      await loadCatalog();
                      setCatalogStatus('Catalog item saved.');
                    } catch (error) {
                      setCatalogStatus(error instanceof Error ? error.message : 'Catalog save failed');
                    }
                  }}
                  type="button"
                >
                  Save Item
                </button>
              </div>

              <p className="text-xs text-neutral-700">{catalogStatus}</p>
            </section>
          ) : null}

          {activeTab === 'Sessions' ? (
            <section className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
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

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
                  onClick={createSession}
                  type="button"
                >
                  Create Session (Host)
                </button>
                <input
                  className="w-full sm:min-w-72 border border-neutral-300 px-2 py-2 text-sm"
                  onChange={(event) => setSessionId(event.target.value)}
                  placeholder="Session ID"
                  value={sessionId}
                />
                <button
                  className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white"
                  onClick={() => {
                    void joinSessionById(sessionId);
                  }}
                  type="button"
                >
                  Join Session
                </button>
                <button
                  className="border border-neutral-400 px-3 py-2 text-sm"
                  onClick={() => {
                    if (sessionId) {
                      void loadSessionState(sessionId);
                    }
                  }}
                  type="button"
                >
                  Refresh Host View
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-neutral-300 p-3">
                  <h3 className="text-sm font-semibold text-neutral-900">Host Join QR</h3>
                  {role === 'host' && hostJoinQr ? (
                    <Image
                      alt="Host Session Join QR"
                      className="mt-2 border border-neutral-300"
                      height={220}
                      src={hostJoinQr}
                      unoptimized
                      width={220}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-neutral-500">Create/select host session to show join QR.</p>
                  )}
                </div>

                <div className="border border-neutral-300 p-3">
                  <h3 className="text-sm font-semibold text-neutral-900">Scan Host QR To Join</h3>
                  <button
                    className="mt-2 border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white"
                    onClick={() => setScanJoinActive((value) => !value)}
                    type="button"
                  >
                    {scanJoinActive ? 'Stop Scan' : 'Scan Host QR'}
                  </button>

                  {scanJoinActive ? (
                    <div className="mt-2">
                      <video className="max-h-52 w-full border border-neutral-300 bg-black" muted playsInline ref={joinScanVideoRef} />
                      <canvas className="hidden" ref={joinScanCanvasRef} />
                    </div>
                  ) : null}

                  {scanJoinStatus ? <p className="mt-2 text-xs text-neutral-700">{scanJoinStatus}</p> : null}
                </div>
              </div>

              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Sync</h3>
                <p className="mt-1 text-xs text-neutral-700">{sessionStatus}</p>
                <button
                  className="mt-2 border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white disabled:opacity-60"
                  disabled={isSyncing}
                  onClick={syncNow}
                  type="button"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <p className="mt-2 text-xs text-neutral-700">{syncStatus}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  Sync sends local pending events to backend and aggregates counts across all devices for this same session.
                </p>
              </div>
            </section>
          ) : null}

          {activeTab === 'Count View' ? (
            <section className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <section className="space-y-3">
                  <BarcodeScanner onDetected={onScanValue} />

                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Current Scanned Item</h3>
                    <p className="mt-1 text-xs text-neutral-700">
                      Scan barcode. Matched item is selected and +1 is added automatically.
                    </p>

                    <div className="mt-2 border border-neutral-200 p-2 text-xs">
                      {activeItem ? (
                        <div className="space-y-1">
                          <p><span className="font-semibold">Item:</span> {activeItem.item_name}</p>
                          <p><span className="font-semibold">System ID:</span> {activeItem.system_id}</p>
                          <p><span className="font-semibold">UPC:</span> {activeItem.upc || 'n/a'}</p>
                        </div>
                      ) : (
                        <p>No matched item selected. Last scanned code: {activeScannedCode || 'none'}.</p>
                      )}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <button
                        className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white disabled:opacity-60"
                        disabled={!activeItem}
                        onClick={() => {
                          if (activeItem) {
                            void appendEvent(activeItem.system_id, 1);
                          }
                        }}
                        type="button"
                      >
                        +1 Current Item
                      </button>
                      <button
                        className="border border-neutral-700 px-3 py-2 text-xs disabled:opacity-60"
                        disabled={!activeItem}
                        onClick={() => {
                          if (activeItem) {
                            void appendEvent(activeItem.system_id, -1);
                          }
                        }}
                        type="button"
                      >
                        -1 Current Item
                      </button>
                    </div>
                  </div>

                  {lookupCandidates.length > 0 ? (
                    <div className="border border-amber-300 bg-amber-50 p-3">
                      <h4 className="text-sm font-semibold text-amber-900">Fallback Item Lookup</h4>
                      <p className="mt-1 text-xs text-amber-900">{lookupStatus}</p>
                      <div className="mt-2 max-h-56 overflow-auto border border-amber-200 bg-white">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-amber-100">
                            <tr>
                              <th className="border-b border-amber-200 px-2 py-1">Item</th>
                              <th className="border-b border-amber-200 px-2 py-1">System ID</th>
                              <th className="border-b border-amber-200 px-2 py-1">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lookupCandidates.map((candidate) => (
                              <tr key={candidate.row_id}>
                                <td className="border-b border-amber-100 px-2 py-1">{candidate.item_name}</td>
                                <td className="border-b border-amber-100 px-2 py-1">{candidate.system_id}</td>
                                <td className="border-b border-amber-100 px-2 py-1">
                                  <button
                                    className="border border-amber-700 bg-amber-700 px-2 py-1 text-white"
                                    onClick={async () => {
                                      setActiveItem(candidate);
                                      await appendEvent(candidate.system_id, 1);
                                      setLookupCandidates([]);
                                      setLookupStatus('');
                                      setSyncStatus(`Selected ${candidate.item_name}. +1 added.`);
                                    }}
                                    type="button"
                                  >
                                    Select +1
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <div className="border border-neutral-300 p-3">
                    <h3 className="text-sm font-semibold text-neutral-900">Count Totals (Current Session)</h3>
                    <div className="mt-2 max-h-80 overflow-auto border border-neutral-200">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-neutral-100">
                          <tr>
                            <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Item</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Qty</th>
                            <th className="border-b border-neutral-300 px-2 py-1">Edit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countRows.map((row) => (
                            <tr key={row.system_id}>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.system_id}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.item_name}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">{row.qty}</td>
                              <td className="border-b border-neutral-200 px-2 py-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <button
                                    className="border border-neutral-500 px-2 py-1"
                                    onClick={() => {
                                      void appendEvent(row.system_id, -1);
                                    }}
                                    type="button"
                                  >
                                    -1
                                  </button>
                                  <button
                                    className="border border-neutral-700 bg-neutral-800 px-2 py-1 text-white"
                                    onClick={() => {
                                      void appendEvent(row.system_id, 1);
                                    }}
                                    type="button"
                                  >
                                    +1
                                  </button>
                                  <input
                                    className="w-16 border border-neutral-300 px-1 py-1"
                                    inputMode="numeric"
                                    onChange={(event) =>
                                      setQtyDraftBySystemId((prev) => ({
                                        ...prev,
                                        [row.system_id]: event.target.value
                                      }))
                                    }
                                    placeholder={String(row.qty)}
                                    value={qtyDraftBySystemId[row.system_id] ?? ''}
                                  />
                                  <button
                                    className="border border-brand-maroon bg-brand-maroon px-2 py-1 text-white"
                                    onClick={() => {
                                      void applyAbsoluteQty(row.system_id);
                                    }}
                                    type="button"
                                  >
                                    Set
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {activeTab === 'Finalize & Upload' ? (
            <section className="space-y-3">
              <div className="border border-neutral-300 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Session State</h3>
                <p className="mt-1 text-xs text-neutral-700">End session to commit host copy, then finalize or lock.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white disabled:opacity-60"
                    disabled={isEndingSession || role !== 'host'}
                    onClick={endSession}
                    type="button"
                  >
                    {isEndingSession ? 'Ending Session...' : 'End Session (Commit Host Copy)'}
                  </button>
                  <button
                    className={`border px-3 py-2 text-xs ${
                      finalAction === 'finalize' ? 'border-red-700 bg-red-700 text-white' : 'border-neutral-700 bg-white'
                    } disabled:opacity-60`}
                    disabled={isFinalizing}
                    onClick={() => finalizeSession(false)}
                    type="button"
                  >
                    {isFinalizing && finalAction === 'finalize' ? 'Finalizing...' : 'Finalize (No Lock)'}
                  </button>
                  <button
                    className={`border px-3 py-2 text-xs ${
                      finalAction === 'lock' ? 'border-red-800 bg-red-800 text-white' : 'border-neutral-700 bg-white'
                    } disabled:opacity-60`}
                    disabled={isFinalizing}
                    onClick={() => finalizeSession(true)}
                    type="button"
                  >
                    {isFinalizing && finalAction === 'lock' ? 'Locking...' : 'Lock Session'}
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
                <h3 className="text-sm font-semibold text-neutral-900">Upload Payload Preview</h3>
                <div className="mt-2 max-h-64 overflow-auto border border-neutral-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-neutral-100">
                      <tr>
                        <th className="border-b border-neutral-300 px-2 py-1">System ID</th>
                        <th className="border-b border-neutral-300 px-2 py-1">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadRows.map((row) => (
                        <tr key={row.system_id}>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.system_id}</td>
                          <td className="border-b border-neutral-200 px-2 py-1">{row.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-red-300 bg-red-50 p-3">
                <h3 className="text-sm font-semibold text-red-900">Upload to R-Series (Host Only)</h3>
                <p className="mt-1 text-xs text-red-800">
                  OAuth + 2FA supported. Upload uses backend defaults for count naming and rate settings.
                </p>

                <button
                  className="mt-2 border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white"
                  onClick={startOauth}
                  type="button"
                >
                  Start OAuth (2FA)
                </button>
                {oauthAuthorizeUrl ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      className="border border-neutral-400 px-3 py-2 text-xs"
                      onClick={() => window.open(oauthAuthorizeUrl, '_blank', 'noopener,noreferrer')}
                      type="button"
                    >
                      Open authorize_url
                    </button>
                    <button
                      className="border border-neutral-400 px-3 py-2 text-xs"
                      onClick={async () => {
                        await navigator.clipboard.writeText(oauthAuthorizeUrl);
                        setOauthStatus('authorize_url copied. Paste into browser and complete login + 2FA.');
                      }}
                      type="button"
                    >
                      Copy authorize_url
                    </button>
                    <span className="text-xs text-neutral-700">
                      Use `authorize_url` only. Never open `redirect_uri` directly or you will get
                      &nbsp;&quot;Missing OAuth code in callback query.&quot;
                    </span>
                  </div>
                ) : null}
                {oauthStatus ? <p className="mt-2 text-xs text-neutral-700">{oauthStatus}</p> : null}

                <p className="mt-2 text-xs text-red-900">
                  Reconcile is enabled for this action: items omitted from upload payload are set to 0 by backend.
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
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
                      await refreshPendingState(sessionId);
                      setSyncStatus('Local offline cache cleared for this session.');
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
