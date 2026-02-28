# tasks.md

## 0. Delivery Plan (Suggested Milestones)

### Milestone 1 — Core logging + calculations (MVP)
- Menu (seed initial products)
- Daily Log form
- Computation + persistence
- Basic History view (table)

### Milestone 2 — Analytics + exports
- A/B Analysis
- Filters + drilldowns
- CSV exports

### Milestone 3 — Forecasting
- Regression-ready dataset generation
- Baseline forecast (rolling average)
- Optional: regression upgrade

---

## 1. Epic: CFA Menu Management

### 1.1 UI / UX
- [ ] Create **Inventory → Chick-fil-A → Menu** page
- [ ] Menu table: name, buyCost, sellPrice, active, lastUpdated
- [ ] “Add item” modal/form (admin only)
- [ ] “Edit item” modal/form (admin only)
- [ ] “Disable item” confirmation (admin only)
- [ ] Show read-only menu view for CFA Staff

### 1.2 Validation
- [ ] Validate itemId uniqueness + allowed characters
- [ ] Enforce cents integer inputs
- [ ] Warn if sellPrice < buyCost but allow (finance override)

### 1.3 Data / Persistence
- [ ] Create data model/table: `cfa_items`
- [ ] Seed initial items:
  - strip_sliders (245/400)
  - half_grilled_cool_wrap (349/500)
- [ ] Add audit fields: updatedAt/updatedBy

---

## 2. Epic: Daily Selling Log

### 2.1 UI / UX
- [ ] Create **Inventory → Chick-fil-A → Daily Log** page
- [ ] Date picker + dayType display (auto)
- [ ] Period display (A→2, B→6)
- [ ] Per-item inputs for each active item:
  - receivedQty, leftoverQty, missedDemandQty
- [ ] “Save” action + success message
- [ ] Ability to open an existing date and edit (permissions-aware)

### 2.2 Validation
- [ ] receivedQty >= 0
- [ ] leftoverQty >= 0 and leftoverQty <= receivedQty
- [ ] missedDemandQty >= 0
- [ ] Clear error messages and field highlighting

### 2.3 Computation
- [ ] Compute per-item: soldQty, trueDemandQty, revenue, cogs, profit, marginPct
- [ ] Compute daily totals: totalRevenue, totalCogs, totalProfit, stockoutFlag
- [ ] Recompute on every save/update

### 2.4 Data / Persistence
- [ ] Create `cfa_daily_logs` (header) and `cfa_daily_log_lines` (lines)
- [ ] Enforce uniqueness:
  - one log per (date, dayType)
  - one line per (logId, itemId)

### 2.5 Permissions
- [ ] CFA Staff can create/edit logs
- [ ] Only Admin/Exec/Finance can override dayType

---

## 3. Epic: History View

### 3.1 UI / UX
- [ ] Create **Inventory → Chick-fil-A → History** page
- [ ] Default view: last 30 days
- [ ] Filters:
  - date range
  - dayType A/B/All
  - item filter (optional)
- [ ] Table rows per day with totals
- [ ] Expand row / details view to show per-item metrics

### 3.2 Data Aggregation
- [ ] Query logs and display computed totals correctly
- [ ] Support pagination or infinite scroll (if needed)

### 3.3 Edge Cases
- [ ] Empty state (no logs yet)
- [ ] Partial log (some items missing) — decide: disallow on save OR show as incomplete

---

## 4. Epic: A/B Analysis

### 4.1 UI / UX
- [ ] Create **Inventory → Chick-fil-A → A/B Analysis** page
- [ ] Date range selector
- [ ] Comparison panels:
  - avg soldQty per item (A vs B)
  - avg trueDemand per item (A vs B)
  - stockout frequency (A vs B)
  - avg profit/day (A vs B)
- [ ] Optional: trend chart over time per dayType

### 4.2 Computation
- [ ] Build aggregation functions grouped by dayType and itemId
- [ ] Stockout frequency = (# days with missedDemand > 0) / (total days)
- [ ] Ensure metrics are computed within filter range

### 4.3 UX Edge Cases
- [ ] Insufficient data state
- [ ] Explain metrics tooltip text (short)

---

## 5. Epic: Exports (CSV)

### 5.1 UI
- [ ] Add “Export CSV” actions (Admin/Exec/Finance only)
- [ ] Export options:
  - Daily summary
  - Item-level regression-ready

### 5.2 CSV Generation
- [ ] Implement export formatter for Daily summary
- [ ] Implement export formatter for Item-level rows
- [ ] Ensure cents columns + optional formatted dollar columns
- [ ] Validate Excel-safe CSV escaping

### 5.3 Permissions + Auditing
- [ ] Restrict exports by role
- [ ] Log who exported + when (optional)

---

## 6. Epic: Forecasting

### 6.1 MVP Forecast
- [ ] Create **Inventory → Chick-fil-A → Forecast** page
- [ ] For each item and dayType:
  - compute rolling_avg_3_sameType from history
  - show recommended stock = ceil(rolling_avg_3_sameType)
- [ ] Show expected profit using current cost/price

### 6.2 Regression-ready Features
- [ ] Generate derived columns:
  - weekday, month
  - rolling averages
  - lag demand
- [ ] Ensure export includes these features

### 6.3 Upgrade Path (Optional)
- [ ] Add simple linear/ridge regression
- [ ] Keep separate models for A/B per item
- [ ] Show accuracy metrics (MAE) if enough data

---

## 7. Epic: Permissions & Roles

- [ ] Define roles in auth/DB
- [ ] Gate routes/components by role
- [ ] Enforce role checks server-side if backend exists
- [ ] Add “permission denied” UI states

---

## 8. QA Checklist

### Calculations
- [ ] soldQty = received - leftover
- [ ] trueDemandQty = sold + missed
- [ ] revenue = sold * sellPrice
- [ ] cogs = sold * buyCost
- [ ] profit = revenue - cogs
- [ ] marginPct handles revenue=0

### Data Integrity
- [ ] leftover never exceeds received
- [ ] cannot input negative values
- [ ] daily totals match sum of lines

### A/B correctness
- [ ] A-day always maps to period 2 unless overridden
- [ ] B-day always maps to period 6 unless overridden
- [ ] A/B comparisons use correct subsets

### Permissions
- [ ] staff cannot edit menu or export
- [ ] admin can edit menu and export
- [ ] dayType override restricted

---

## 9. Nice-to-have Enhancements (Backlog)

- [ ] “Incomplete log” draft mode (save received first, fill leftover later)
- [ ] Notifications/reminders to fill end-of-period leftover
- [ ] Visual stockout marker + notes field (“ran out at 10:12”)
- [ ] Per-item notes (quality, packaging issues)
- [ ] Price-testing support (effective date ranges for price/cost changes)
- [ ] Dashboard summary cards (This week profit, Stockout count)