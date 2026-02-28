# requirements.md

## 1. Overview

### 1.1 Goal
Build a **Chick-fil-A Dashboard** inside the existing website to track CFA operations using **manual counts + sell-out demand**. The system must support:
- Daily logging of **received**, **leftover**, and **missed demand after sell-out**
- Automatic computation of **sales, revenue, COGS, profit, margin**
- Analytics views: **day-by-day history**, **A vs B comparison**
- Forecasting support: **regression-ready dataset** and basic forecasting outputs
- UI-based admin controls for **menu management** (costs/prices/items)
- No dependency on Lightspeed sales; Lightspeed may be added later for validation only.

### 1.2 Operating Model
- Products are sold on campus during:
  - **A-day → 2nd period**
  - **B-day → 6th period**
- At the start of the selling period, staff logs **receivedQty**.
- At the end, staff logs **leftoverQty**.
- If sold out, staff logs **missedDemandQty** (# people who asked after sell-out).

### 1.3 Initial Menu (Default)
1) **CFA Strip Sliders**
- buyCost: **$2.45** (245 cents)
- sellPrice: **$4.00** (400 cents)

2) **CFA Half Grilled Cool Wrap**
- buyCost: **$3.49** (349 cents)
- sellPrice: **$5.00** (500 cents)

---

## 2. Users, Roles, and Permissions

### 2.1 Roles
- **CFA Staff**
  - Can submit/edit daily logs for allowed days
  - Can view history & analytics (read-only)
- **CFA Admin**
  - All staff permissions
  - Can edit menu items (cost/price, activate/deactivate)
  - Can override dayType when needed
  - Can export data (CSV)
- **Exec / Finance**
  - Same as CFA Admin
  - May have additional dashboard overview access

### 2.2 Permission Rules (Must)
- Menu editing (add/remove/update prices/costs) restricted to: `CFA Admin`, `Exec`, `Finance`
- DayType override restricted to: `CFA Admin`, `Exec`, `Finance`
- Exports restricted to: `CFA Admin`, `Exec`, `Finance`
- Daily log creation allowed for: `CFA Staff` and above

### 2.3 Audit Trail (Should)
- Track who edited:
  - Menu changes (before/after values)
  - Daily log changes
- Store: `updatedBy`, `updatedAt`, and optionally a change history record.

---

## 3. Navigation / UI Requirements

### 3.1 Location in Website
Add new module under:
- **Inventory → Chick-fil-A**
  - **Daily Log**
  - **History**
  - **A/B Analysis**
  - **Forecast**
  - **Menu** (restricted)

### 3.2 UI: Menu Management (Approved Roles)
**Inventory → Chick-fil-A → Menu**

**Actions**
- View items (everyone with CFA access)
- Add new item (approved roles)
- Edit buy cost / sell price / name (approved roles)
- Disable/remove item (approved roles)

**Fields per item**
- `itemId` (string, unique, immutable slug; ex: `strip_sliders`)
- `name` (string)
- `buyCostCents` (int; >= 0)
- `sellPriceCents` (int; >= 0)
- `active` (boolean)

**Validation**
- `itemId` unique, alphanumeric/underscore only
- `sellPriceCents` should generally be >= `buyCostCents` (warn if not; allow if Finance wants)
- Costs/prices must be integer cents (no floats)

---

## 4. Daily Selling Log (Core Form)

### 4.1 UI Page
**Inventory → Chick-fil-A → Daily Log**

### 4.2 Log Meta Fields
- `date` (YYYY-MM-DD; default: today local timezone)
- `dayType` (A or B)
  - Auto-detected if your system already knows A/B schedule
  - Editable only with permission
- `period` (auto)
  - A → 2
  - B → 6

### 4.3 Per-item Inputs (for each active item)
- `receivedQty` (int; default 0)
- `leftoverQty` (int; default 0)
- `missedDemandQty` (int; default 0)

### 4.4 Required Validation
- `receivedQty >= 0`
- `leftoverQty >= 0`
- `missedDemandQty >= 0`
- `leftoverQty <= receivedQty` (hard validation; if violated show error)
- If `receivedQty == 0`, allow log but warn if other fields > 0
- If sold out (leftoverQty == 0) and missedDemandQty is blank → default to 0 but encourage entry

### 4.5 Save Behavior
- On save, compute all derived fields (see §5).
- Allow edits after save, but keep audit.

---

## 5. Calculations (Computed On Save)

### 5.1 Per Item (for each line item)
Let `receivedQty`, `leftoverQty`, `missedDemandQty`, `sellPriceCents`, `buyCostCents`:

- `soldQty = receivedQty - leftoverQty`
- `trueDemandQty = soldQty + missedDemandQty`
- `revenueCents = soldQty * sellPriceCents`
- `cogsCents = soldQty * buyCostCents`
- `profitCents = revenueCents - cogsCents`
- `marginPct = profitCents / revenueCents` (only if `revenueCents > 0` else null)

### 5.2 Daily Totals
- `totalRevenueCents = Σ(revenueCents)`
- `totalCogsCents = Σ(cogsCents)`
- `totalProfitCents = Σ(profitCents)`
- `stockoutFlag = TRUE if any item has missedDemandQty > 0` (or leftoverQty == 0 AND missedDemandQty > 0)

### 5.3 Display Rules
- Show currency formatted dollars (e.g., `$94.10`) but store cents internally.
- Show margin as % with 1 decimal.

---

## 6. History & Analytics Views

### 6.1 Day-by-Day History
**Inventory → Chick-fil-A → History**

**Must show (per day)**
- date, dayType, period
- totals: revenue, cogs, profit
- per-item: received, leftover, sold, missedDemand, trueDemand, profit

**Filters**
- Date range
- dayType: A / B / All
- Item filter (optional single item view)

**Export**
- CSV export (see §8)

**UX**
- Table with expandable row for per-item details OR a per-day detail drawer.

### 6.2 A-day vs B-day Comparison
**Inventory → Chick-fil-A → A/B Analysis**

**Charts + Tables**
- Avg soldQty per item on A vs B
- Avg trueDemandQty per item on A vs B
- Stockout frequency (percentage of days with missedDemand > 0) on A vs B
- Avg profit per day on A vs B
- Optional: weekday breakdown within A/B (if you have enough data)

**Constraints**
- Must compute using the selected date range.
- If not enough data, show “Insufficient data” state.

### 6.3 Per-item Drilldown (Should)
From History or A/B Analysis, click item to view:
- time series of soldQty vs trueDemandQty
- stockout occurrences
- profit trend

---

## 7. Forecasting (Regression-ready)

### 7.1 Objective
Predict `trueDemandQty` **separately for A and B days** per item.

### 7.2 Model Split
- Separate dataset per dayType:
  - A model per item
  - B model per item

### 7.3 Feature Set (Minimum)
Stored or derived:
- `dayType` (A/B)
- `weekday`
- `month`
- `trueDemandQty` (target)
- Rolling averages on same dayType:
  - `rolling_avg_3_sameType`
  - `rolling_avg_5_sameType` (optional)
- Lag features:
  - `prev_sameType_demand` (optional)

### 7.4 Outputs (UI)
**Inventory → Chick-fil-A → Forecast**
- Recommended stock quantity for next A-day / next B-day
- Expected profit estimate based on current menu prices/costs
- Display confidence band or error estimate if feasible

### 7.5 MVP Forecast Logic (Acceptable)
If implementing regression is too heavy early:
- Start with a baseline:
  - `forecast = rolling_avg_3_sameType`
- Later upgrade to regression.

---

## 8. Export Requirements (CSV)

### 8.1 Export Types
**Export A: Daily summary rows**
- One row per day with totals

Columns:
- date, dayType, period
- totalRevenueCents, totalCogsCents, totalProfitCents, stockoutFlag

**Export B: Item-level rows (Regression-ready)**
- One row per (day, item)

Columns:
- date, dayType, period
- itemId, itemName
- receivedQty, leftoverQty, soldQty, missedDemandQty, trueDemandQty
- sellPriceCents, buyCostCents
- revenueCents, cogsCents, profitCents
- weekday, month
- rolling_avg_3_sameType (if computed)

### 8.2 Access Control
Exports only for: `CFA Admin`, `Exec`, `Finance`.

---

## 9. Data Model Requirements (Backend Optional)

Even if “mostly front-end,” the system needs persistence. If backend exists, it must be same-site (no separate hosted external domain).

### 9.1 Entities
**CFAItem**
- itemId (PK)
- name
- buyCostCents
- sellPriceCents
- active
- createdAt, updatedAt, updatedBy

**CFADailyLog**
- logId (PK)
- date (unique per dayType, or unique per date if dayType derived)
- dayType (A/B)
- period (2/6)
- createdAt, createdBy
- updatedAt, updatedBy
- totals: totalRevenueCents, totalCogsCents, totalProfitCents, stockoutFlag

**CFADailyLogLine**
- lineId (PK)
- logId (FK)
- itemId (FK)
- receivedQty, leftoverQty, missedDemandQty
- computed: soldQty, trueDemandQty, revenueCents, cogsCents, profitCents, marginPct

### 9.2 Uniqueness Constraints
- One CFADailyLog per (date, dayType)
- One CFADailyLogLine per (logId, itemId)

---

## 10. Non-functional Requirements

### 10.1 Performance
- History page should load within ~2s for 6 months of data.
- Exports should complete within reasonable time; show progress for large ranges.

### 10.2 Reliability & Data Integrity
- Prevent negative quantities and leftover > received.
- Always recompute derived fields on save (server-side if backend exists).

### 10.3 Security
- Role checks enforced server-side if backend exists.
- No unauthorized menu edits.

### 10.4 UX Quality
- Mobile-friendly enough to complete the Daily Log quickly.
- Autosave not required; explicit Save is fine.

---

## 11. Acceptance Criteria (Must pass)

1) Menu page allows admins to add/edit/disable items; staff can view.
2) Daily Log can be entered for any date with A/B dayType and records per-item received/leftover/missed.
3) System computes sold/trueDemand/revenue/cogs/profit per item and totals correctly.
4) History page shows day-by-day records with filters and accurate totals.
5) A/B Analysis shows aggregate metrics split by A vs B.
6) Export produces both daily summary and item-level CSV with correct columns.
7) Permissions enforced: staff cannot edit menu or export.
8) Forecast page outputs recommended stock for next A and next B based on at least rolling averages.