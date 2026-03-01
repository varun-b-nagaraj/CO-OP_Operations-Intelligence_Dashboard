requirements.md — Inventory Dashboard (Web) + Offline Inventory Counting
1. Goal

Provide a web-based Inventory Dashboard that enables collaborative inventory counting in low-connectivity environments. Multiple iPhones record scans offline and periodically sync wirelessly when near each other. A host finalizes the count and uploads results to Lightspeed once connectivity is available.

The system must support barcode-driven identification, catalog management, auditability, and offline-first reliability.

2. Key Constraints
Offline Operation

Counting MUST function with no infrastructure Wi-Fi and no cellular data.

Devices MUST be able to operate independently and store events locally.

Sync Strategy

Devices sync wirelessly via Bluetooth Low Energy (BLE).

Sync may occur in short bursts when users step near each other.

Continuous connectivity is NOT required.

Upload Connectivity

Final upload occurs only when the host has internet access.

Upload may occur after stepping outside.

3. Roles
3.1 Host (Manager)

Creates and ends sessions.

Maintains authoritative state.

Reviews and locks results.

Initiates Lightspeed upload.

Confirms backend reconciliation behavior.

3.2 Participant (Counter)

Joins session.

Scans items and submits count events.

Sees totals after sync.

Can disconnect/rejoin without data loss.

4. Inventory Catalog Source
4.1 Canonical Table

The system MUST use:

public."Inventory"

as the catalog source of truth.

4.2 Required Display Fields

Item (name)

System ID

UPC

EAN

Custom SKU

Manufacturer SKU

4.3 Optional Metadata

Used for filtering & reporting:

Vendor

Brand

Department

Category & subcategories

Season

MSRP

Tax class

5. Identifier Handling (Critical)
5.1 Accepted Identifiers

The system MUST support identification using:

UPC (primary)

EAN

System ID

Custom SKU

Manufacturer SKU

5.2 String Handling Requirement

Identifiers MUST be treated as strings.

Reasons:

leading zeros must be preserved

identifiers may include non-numeric characters (e.g. 13+)

numeric casting may cause precision loss

5.3 Lookup Order

Barcode resolution MUST attempt:

UPC

EAN

System ID

Custom SKU

Manufacturer SKU

Normalization rules:

trim whitespace

preserve leading zeros

exact string match only

no integer conversion

6. Inventory Count Ownership

"Qty." MUST NOT be treated as a live count.

Working counts MUST derive ONLY from:

inventory session scan events

manual edits followed by explicit upload

7. Catalog Import & Management
7.1 CSV Drag-and-Drop Import

CSV format matches Lightspeed export structure.

Import MUST be catalog-only.

Allowed:

insert new items

update metadata

NOT allowed:

change counts (ignore "Qty.")

7.2 Upsert Behavior

For each row:

If identifier match exists → update metadata
If no match → insert new item

Counts remain unchanged.

8. Manual Catalog Management

Managers MUST be able to:

Add Items

Required:

System ID

Item name

Recommended:

UPC

Optional:

EAN / SKUs

Edit Metadata

Managers can edit descriptive fields.

Remove Items

soft delete preferred

hard delete optional

Manual Count Edits

Manual adjustments are allowed locally, but MUST NOT upload until explicitly confirmed.

9. Session Workflow
9.1 Create Session

Host creates session:

session_id

name

timestamp

9.2 Join Session

Participants join session and begin scanning.

9.3 Offline Counting

Scans are stored locally immediately.

No connectivity required.

9.4 Burst Sync

When devices are near each other:

devices exchange pending events

reconcile with host state

update totals

9.5 Disconnect & Rejoin

Participants may leave and rejoin.
Un-synced events MUST be preserved and synced later.

10. Event-Based Counting Model
10.1 Event Structure
{
  "event_type": "SCAN",
  "event_id": "deviceUUID:counter",
  "session_id": "uuid",
  "system_id": "string",
  "delta_qty": 1,
  "actor_id": "deviceUUID",
  "timestamp": 1700000000
}
10.2 Event Requirements

events must be uniquely identifiable

host deduplicates events

events applied deterministically

host snapshot is authoritative

11. Snapshot & Recovery

Host periodically produces session snapshot.

Clients reconcile with snapshot during sync.

Rejoining devices receive latest snapshot.

12. Attendance & Accountability

System MUST record:

participant roster

join & leave times

number of events submitted per participant

13. Counting UX Requirements

Participants MUST:

scan UPC quickly

increment/decrement counts

view totals

Host MUST:

monitor progress

identify mismatches vs baseline

identify uncounted items

highlight large discrepancies

14. Finalization Workflow
14.1 End Session

Host ends session:

stops new events

freezes dataset

14.2 Review & Lock

Host reviews discrepancies and locks session.

14.3 Export

Host may export:

CSV

JSON upload payload

15. Lightspeed Upload Workflow
15.1 Upload Timing

Upload occurs when host has connectivity.

15.2 Upload API Integration

System must support:

OAuth Start
GET /api/oauth/start

Upload
POST /api
with:

items[].system_id

items[].qty

Optional:

count_name

shop_id

employee_id

reconcile

rps

16. Backend Reconciliation & Auto Zero-Out

The upload backend performs reconciliation.

Items NOT included in upload are automatically set to quantity 0.

The dashboard MUST NOT pre-zero items.

Host MUST confirm:

Items omitted from upload will be set to zero.

17. Upload Result Handling

System MUST display and log:

upload batch ID

summary results

reconcile status

per-item results

Audit log MUST include:

session id

upload timestamp

payload hash

manager identity

18. Offline Storage Requirements

Client MUST store offline data using:

IndexedDB for event logs & session state

local caching for catalog subset

No data loss permitted.

19. Performance Requirements

scan feedback < 200ms

sync reconciliation < 2 seconds typical

event storage must scale to full inventory count sessions

20. Security & Integrity

sync must prevent duplicate event application

session data is local to participants

upload actions restricted to host role

21. Assumptions

users operate iPhones

users may step outside briefly for sync or upload

UPC is primary identifier for most items

22. Acceptance Criteria

✔ inventory can be counted fully offline
✔ devices can sync events wirelessly in bursts
✔ rejoining devices remain consistent
✔ catalog import does not alter counts
✔ host finalizes and uploads successfully
✔ backend reconciliation zeroes omitted items
✔ audit logs stored