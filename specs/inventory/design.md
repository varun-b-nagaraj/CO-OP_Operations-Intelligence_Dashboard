design.md — Inventory Dashboard (Web) + Offline Multi-iPhone Inventory Checks (No Wi-Fi/Cellular During Count)
1. System Overview

The Inventory Dashboard is a web-based extension of the CO-OP Operations website. It enables collaborative inventory counting in environments with weak/absent connectivity by allowing multiple iPhones to record scan events offline and periodically sync device-to-device using Bluetooth Low Energy (BLE) when users briefly step outside / near each other. At the end, a privileged host uploads the finalized counts to Lightspeed using inventory-upload.vercel.app, where the backend performs reconciliation and automatically zeros out omitted items.

2. Hard Constraints & Platform Reality
2.1 Browser capability constraints (iPhone Safari)

A normal web app cannot use iOS Multipeer Connectivity (native-only).

Therefore, iPhone-to-iPhone offline sync from the browser must use one of:

Web Bluetooth (BLE) — supported on iOS Safari in modern versions but with limitations and UX friction (explicit user gestures, foreground-only behavior).

A native wrapper (Capacitor/React Native WebView) exposing Multipeer to the web layer (not selected in this design since you said “website”).

This design assumes Web Bluetooth BLE.

2.2 Operational constraint

Counting MUST work fully offline.

Sync occurs in bursts when users come within BLE range (doorway/outside).

Final upload happens only when the host has connectivity.

3. Components
3.1 Web Client (Mobile + Desktop)

Runs at /inventory within your website.

Provides:

Session creation/join (host/participants)

Barcode scanning (camera)

Local event log + offline cache

BLE sync (advertise/connect/transfer events)

Review, finalize, export, upload

3.2 Backend (Next.js route handlers / API)

Catalog CRUD & CSV import

Session metadata persistence

Audit logs

Upload orchestration proxy (optional)

3.3 Database (Supabase/Postgres)

public."Inventory" (catalog table; pre-populated)

Inventory session tables (sessions, events, attendance, uploads)

3.4 Lightspeed Upload Service

inventory-upload.vercel.app OAuth + upload + reconcile/zero-out backend

4. Data Model
4.1 Canonical Catalog (existing)

public."Inventory" is the catalog source of truth. Identifier columns used for matching:

"UPC" (primary barcode in practice)

"EAN"

"System ID"

"Custom SKU"

"Manufact. SKU"

"Item" (display)

Important: The web app MUST treat identifiers as strings end-to-end (even if DB columns are bigint) to support values like 13+ and to preserve leading zeros.

4.2 Working Count State

Counts are NOT derived from "Qty." automatically. Working counts are computed from:

session scan events (authoritative)

manual edits in the dashboard

4.3 Session/Event Tables (recommended)

Create separate tables rather than overloading public."Inventory":

inventory_sessions

id (uuid)

name

created_by

status (active | finalizing | locked)

timestamps

inventory_session_participants

session_id

participant_id (device-generated stable ID)

display_name

join/leave timestamps

event_count

inventory_session_events

session_id

event_id (device_id:counter)

actor_id

system_id (string)

delta_qty (int)

event_type

timestamp

unique constraint on (session_id, event_id) for dedupe

inventory_upload_runs

session_id

upload timestamp

payload hash

response summary JSON

reconcile status

5. Barcode Resolution (Web)
5.1 Lookup Order (exact match)

When a barcode is scanned, attempt match in order:

"UPC"

"EAN"

"System ID"

"Custom SKU"

"Manufact. SKU"

Normalization:

trim whitespace

preserve leading zeros

no numeric coercion

If no match:

user can create a “pending item” entry to be resolved later (requires System ID + Item name at minimum).

6. Offline-First Client Storage
6.1 Local persistence

The web client MUST persist offline data using:

IndexedDB (preferred) for:

event log

session state snapshots

catalog cache (subset)

LocalStorage only for lightweight flags/session pointers.

6.2 Event log format

Each device stores an append-only log:

{
  "event_type": "SCAN",
  "event_id": "deviceUUID:counter",
  "session_id": "uuid",
  "system_id": "string",
  "delta_qty": 1,
  "actor_id": "deviceUUID",
  "timestamp": 1700000000
}
7. BLE Sync Protocol (Web Bluetooth)
7.1 Topology

Host-centric sync:

Host device acts as BLE Peripheral (advertising)

Participants act as BLE Central (connect + transfer)

Note: iOS Web Bluetooth peripheral support can be constrained. If true peripheral advertising from browser is not viable, reverse the topology:

Host acts as Central connecting to each participant (who must expose a GATT server) — also may be constrained.
If neither is viable in pure web, the fallback is “single-phone counting” or “native wrapper.” (See §12.)

7.2 GATT Service Design

Define a custom GATT Service UUID COOP_INVENTORY_SYNC.

Characteristics:

SESSION_INFO (read)

session id, name, host id, version

EVENT_PUSH (write-with-response)

client → host: send event batch

SNAPSHOT_PULL (read/notify)

host → client: send snapshot summary (counts + last event ids)

ACK (notify)

host → client: ack received event ids / high-watermark

7.3 Sync Mechanics (Burst Sync)

Client keeps a pending_events queue.

On BLE connection:

Client reads SESSION_INFO

Client sends events in batches via EVENT_PUSH

Host ACKs (by id range or list)

Client pulls SNAPSHOT_PULL

Client reconciles to host snapshot

Batch rules:

compress events (JSONL or msgpack)

chunk into <= N bytes per BLE write

retry on failure

dedupe at host by unique (session_id, event_id)

8. Session Workflow (Web)
8.1 Create session (Host)

Host creates session in UI (works offline; stored locally)

Host starts BLE advertising (if supported)

Host displays session name/code for human verification

8.2 Join session (Participants)

Participant selects session manually (QR code optional)

Participant begins scanning; events stored locally immediately

Participant periodically “Sync Now” when near host / outside

8.3 Finalize

Host ends session (offline allowed)

Host performs review:

mismatches vs baseline

uncounted items

large deltas

Host locks session

8.4 Upload (Connectivity Required)

When outside with connectivity, host initiates:

OAuth start (/api/oauth/start)

Upload finalized payload (POST /api)

Backend reconciliation behavior:

The upload backend automatically zeros out any omitted items.

9. CSV Import & Catalog Management (Web)
9.1 Drag-and-drop CSV

Accept Lightspeed-export-shaped CSV.

Import behavior is catalog-only:

may insert/update metadata

MUST ignore "Qty." for count changes

9.2 Manual add item

Manager can add new item by specifying:

System ID (string)

Item name

UPC optional but preferred

EAN/SKUs optional

This updates public."Inventory".

10. Upload Payload Construction

Final upload items list contains only items with intended non-zero final QOH:

{
  "items": [
    { "system_id": "210000000624", "qty": 1 }
  ],
  "reconcile": true
}

Omission implication:

Items not present will be zeroed by backend during reconcile.

Host UI must require confirmation:

“Items omitted from upload will be set to 0 by backend reconciliation.”

11. UI Modules (Web)

Inventory Catalog

search/filter

CSV import

add/edit/remove items

Inventory Sessions

create/start/end

participants + attendance

sync status per participant (last sync time, pending events)

Counting View

barcode scanner

quick adjust

per-item totals

Finalize & Upload

delta review

export CSV/JSON

upload to Lightspeed

12. Risk Register & Fallback Plan (Critical)
12.1 Web Bluetooth feasibility risks (iOS)

BLE peripheral advertising / GATT server from browser may be limited or unreliable.

BLE throughput and user gesture requirements may impact UX.

Background BLE is effectively not available; requires screens on.

12.2 Recommended fallback if BLE is blocked

If web-only BLE is not feasible enough for multi-device:

Switch to native wrapper (Capacitor) for the counting view only:

exposes iOS Multipeer Connectivity

keeps rest of system as website

Or adopt a single-host scanning workflow (multiple scanners not required).

13. Acceptance Criteria

Users can count items entirely offline (events stored locally).

Sync can be performed by stepping near host, transferring all queued events reliably.

Host can finalize a single authoritative count set.

Host can export CSV/JSON.

Host can upload when connectivity available; backend reconciles and zeros omitted items automatically.

Catalog can be maintained via CSV import (metadata-only) and manual adds; import never changes counts.