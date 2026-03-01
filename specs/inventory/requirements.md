requirements.md — Inventory Dashboard + Offline Multi-iPhone Inventory Check
1. Goal

Provide an Inventory Dashboard that supports collaborative inventory counting using iPhone-to-iPhone offline synchronization (no internet required during counting), while integrating with the public."Inventory" catalog table and enabling a single manager/host to upload finalized counts to Lightspeed once connectivity is available (e.g., stepping outside briefly).

The system must support barcode-driven identification (primarily UPC), catalog management, auditability, and offline-first reliability.

2. Key Constraints

During counting: the system MUST function with no infrastructure Wi-Fi and no cellular data.

Sync transport: MUST use iOS Multipeer Connectivity (Bluetooth + Apple peer-to-peer transport).

Connectivity moments: users MAY step outside briefly to:

improve peer connectivity for sync bursts

upload final results at session end

Counting MUST NOT require sustained internet connectivity.

System MUST tolerate intermittent peer connectivity (drops, re-joins) without losing or duplicating scan results.

3. Roles
3.1 Host (Manager)

Starts and ends inventory sessions.

Advertises the session and accepts participants.

Maintains authoritative session state.

Finalizes/locks results.

Initiates Lightspeed upload when connectivity becomes available.

Controls zero-out behavior and final reconciliation.

3.2 Participant (Counter)

Joins nearby sessions automatically (no login required in v1).

Scans items and submits count deltas.

Sees real-time aggregated totals.

May leave and rejoin without data loss.

4. Inventory Catalog Source (Database)
4.1 Source of Truth Table

The system MUST use:

public."Inventory"

as the canonical catalog table.

The dashboard MUST read and display at minimum:

"Item" (name)

"System ID"

"UPC"

"EAN"

"Custom SKU"

"Manufact. SKU"

Optional metadata for filtering:

Vendor

Brand

Department

Category & Subcategories

Season

MSRP

Tax Class

Default Cost

5. Identifier Handling (Critical)
5.1 Valid Identifiers

The system MUST treat the following as valid item identifiers:

"UPC" (primary barcode in practice)

"EAN"

"System ID"

"Custom SKU"

"Manufact. SKU"

5.2 String Handling Requirement

Identifiers MUST be handled as strings in the application layer, even if stored as bigint in the database.

Reasons:

UPC/System ID may contain:

leading zeros

non-numeric characters (13+)

long numeric strings exceeding safe integer precision

5.3 Lookup Matching Order

When a barcode is scanned, lookup MUST attempt:

exact match "UPC"

exact match "EAN"

exact match "System ID"

exact match "Custom SKU"

exact match "Manufact. SKU"

Normalization rules:

trim whitespace

preserve leading zeros

DO NOT coerce to integer

exact string equality only

6. Inventory Counts Ownership

The "Qty." column MUST NOT be treated as a live updating count field.

Working counts MUST be derived ONLY from:

inventory check session events

manual edits in the dashboard followed by explicit upload

No other process may modify counts.

7. Inventory Baseline Input

Baseline inventory MUST be loadable via:

database table (public."Inventory")

spreadsheet upload (CSV)

manual dashboard edits

Baseline dataset MUST include identifiers that can map to Lightspeed upload format (system_id preferred).

8. CSV Drag-and-Drop Import (Catalog Upsert Only)
8.1 Supported Format

CSV format MUST match the Lightspeed export shape.

8.2 Import Behavior

CSV import MUST be catalog-only:

Allowed:

add new items

update metadata

NOT allowed:

change counts (ignore "Qty.")

8.3 Upsert Rules

For each row:

If identifier match exists →
→ update metadata only

If no match exists →
→ insert new catalog item

Counts remain unchanged.

9. Manual Catalog Management

Dashboard MUST allow managers to:

9.1 Add Items

Required:

System ID

Item name

Recommended:

UPC

EAN / SKUs

9.2 Edit Metadata

Managers can edit descriptive/catalog fields.

9.3 Remove Items

soft delete preferred

hard delete optional

9.4 Manual Count Edits

Manual count adjustments are allowed in UI, but:

Counts MUST NOT be uploaded until user explicitly selects Upload to R-Series.

10. Session Creation & Discovery
10.1 Session Creation

Host creates session with:

session_id (UUID)

session_name

timestamp

optional metadata

10.2 Discovery

Host advertises via Multipeer.

Participants discover and join.

Join Behavior (v1)

join by default when selecting session

host approval optional

11. Offline Sync Architecture (Core)
11.1 Real-Time Sync

Participant scans MUST update:

host authoritative totals

all participant views

11.2 Event-Based Counting Model (Required)

Each event MUST include:

event_type (SCAN, ADJUST, UNDO)

event_id (deviceUUID:counter)

session_id

system_id

delta_qty

actor_id

timestamp

Host Responsibilities

deduplicate by event_id

apply events deterministically

broadcast updates

Participant Responsibilities

queue unacknowledged events

retry on reconnect

accept host snapshot as truth

12. Snapshot & Recovery

Host MUST periodically broadcast STATE_SNAPSHOT.

Participants MUST reconcile to snapshot.

Rejoining participants MUST receive latest snapshot automatically.

13. Counting UX

Participants MUST:

scan UPC quickly

increment/decrement counts

view personal contributions & totals

Host MUST:

view total progress

view per-user contributions

identify mismatches vs baseline

identify uncounted items

highlight large deltas

14. Attendance Tracking

Per session, system MUST record:

participant roster

join/leave timestamps

event counts per participant

15. Session Finalization

Host may end session:

stops new events

freezes dataset

Host MAY review/edit before lock.

After lock:

results exportable

ready for upload

16. Export & Upload Workflow
16.1 Export

Host can export:

CSV

JSON payload (upload-ready)

Fields:

system_id

counted_qty

expected_qty

delta_qty

16.2 Upload Timing

Counting MUST work offline.

Upload occurs later when connectivity is available.

16.3 Lightspeed Upload API Integration

1️⃣ OAuth start
GET /api/oauth/start

2️⃣ Upload
POST /api

Required payload:

items[].system_id

items[].qty

Optional:

count_name

shop_id

employee_id

reconcile

rps

16.4 Zero-Out Uncounted Items

System MUST support optional zeroing of uncounted items.

This MUST be:

host controlled

accompanied by warning

16.4 Backend Reconciliation + Auto Zero-Out (Authoritative)

The system MUST treat inventory-upload.vercel.app as the authority for reconciliation behavior.

On upload, the backend MUST zero out any items not included in the uploaded items[] list (i.e., items not counted are set to qty=0) as part of its reconciliation process.

The dashboard MUST NOT attempt to pre-zero items locally; it only uploads the finalized counted set and relies on the backend to apply the zero-out rule.

The dashboard MUST clearly warn the host that omitting an item from the upload implies it will be zeroed by the backend.

16.5 Upload Payload Implication

Upload payload MUST include only items that should retain non-zero QOH after reconciliation.

The host MUST have an explicit confirmation step acknowledging:

“Items not present in this upload will be set to 0 by the backend.”

16.6 Upload Result Handling (unchanged behavior, but log zero-out implication)

Upload results MUST display/log:

the backend reconcile status

summary counts

and a note that “zero-out is applied backend-side for omitted items.”

17. Upload Rules

Upload is host-only action.

Upload uses finalized counts only.

Catalog changes are NOT uploaded.

18. Data Type & Schema Safety

Because "System ID" and "UPC" may contain non-numeric values:

System SHOULD:

migrate these columns to TEXT
OR

provide text-safe parallel storage

CSV importer MUST:

avoid integer casting failures

reject invalid rows with clear error report if necessary

19. Non-Functional Requirements
Offline First

No internet required during counting.

No data loss under disconnects.

Performance

scan feedback < 200ms

sync latency target < 2 seconds

Data Integrity

no duplicate counts

host snapshot canonical

Security (v1)

encrypted Multipeer transport where possible

upload restricted to host

20. Assumptions

all participants use iPhones

users may briefly step outside to sync/upload

21. Acceptance Criteria

✅ host starts session and participants join
✅ scans update across devices offline
✅ disconnect/rejoin maintains consistency
✅ session finalizes and exports correctly
✅ upload succeeds when connectivity available
✅ audit logs stored