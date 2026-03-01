# Design Document: Product Dashboard

## 1. Purpose

The Product Dashboard is an operations module for the Round Rock CO-OP School Store that centralizes:

- Purchase orders (creation → approval → ordered → receiving → archive)
- Vendor registry and purchasing metadata
- Product catalog + inventory thresholds (reorder point, par)
- Inventory-check uploads and automated reorder prompting
- Product designs (front/back mockups, priority, “ready to order”)
- Wishlist items (ideas → designs → order drafts)

This document describes the recommended architecture, data model, UI/UX layout, and key workflows.

---

## 2. Goals and Non-Goals

### Goals
- Single “source of truth” for orders, receiving, and reorder prompts.
- Prompt reorder suggestions automatically after inventory uploads.
- Keep everything editable via UI and persisted in DB.
- Make it permission-ready even if v1 is open access.
- Preserve historical data: archive rather than delete.

### Non-Goals (v1)
- Automated vendor purchasing (placing orders via APIs).
- Accounting system integration.
- Barcode scanning (can be added later).
- Full RBAC enforcement (scaffolding only).

---

## 3. High-Level Architecture

### Recommended stack
- Frontend: Next.js (App Router) + Tailwind
- Backend boundary: Next.js Route Handlers / Server Actions
- Database: Supabase Postgres + Storage for file uploads
- Auth: optional in v1; design should support adding Supabase Auth later
- Realtime (optional): Supabase Realtime for live updates to order status/prompts

### Security boundary
- Reads: client-side Supabase queries (with RLS allowing reads in v1)
- Writes: server-side route handlers to enforce validation + future auth/approval rules
- File uploads: Supabase Storage with signed URLs; metadata stored in DB

---

## 4. Core Entities (Conceptual Model)

### 4.1 Settings
Stores defaults shown at the top of the order form.

- requester_name_default = "Eric Chaverria"
- activity_account_default = "Round Rock CO-OP (School Store)"
- account_number_default = "498-36-001-99-8468-6399"

### 4.2 Vendors
Registry of vendors used across orders, products, and designs.

### 4.3 Products (Catalog)
Canonical representation of an item that may appear in inventory and on orders.

### 4.4 Inventory Uploads + Inventory Levels
- Inventory uploads represent a completed inventory check (snapshot).
- Inventory levels represent the latest “current stock” per product.

### 4.5 Purchase Orders + Lines
Purchase order header and line items.

### 4.6 Receipts (Receiving) + Receipt Lines
Receiving events that can be partial, associated to an order.

### 4.7 Designs
Merch design entries with images and metadata.

### 4.8 Wishlist Items
Ideas that can be converted into designs or order drafts.

### 4.9 Order Prompts
Generated prompts from inventory checks to recommend reorders.

### 4.10 Attachments
Files tied to orders/designs (quotes, mockups, invoices, receipts).

### 4.11 Audit Log
Append-only log of changes to critical entities.

---

## 5. Data Model (Postgres/Supabase)

> Names below are suggestions; adapt to your repo conventions.

### 5.1 Table: `settings`
- `id` (pk, uuid)
- `key` (text, unique) — e.g. `order.requester_default`
- `value` (jsonb or text)
- `updated_at` (timestamptz)
- `updated_by` (uuid/text)

### 5.2 Table: `vendors`
- `id` (uuid)
- `name` (text, unique)
- `ordering_method` (enum: online, in_store, phone, other)
- `default_link` (text, nullable)
- `lead_time_days` (int, nullable)
- `notes` (text)
- `is_active` (bool)

### 5.3 Table: `products`
- `id` (uuid)
- `sku` (text, unique)
- `name` (text)
- `category` (text)
- `preferred_vendor_id` (uuid, fk vendors)
- `vendor_product_link` (text, nullable)
- `default_unit_cost` (numeric, nullable)
- `retail_price` (numeric, nullable)
- `barcode_upc` (text, nullable)
- `reorder_threshold` (int, default 5)
- `par_level` (int, default 0)  // target stock
- `is_active` (bool, default true)

Indexes:
- `(name)` for search
- `(preferred_vendor_id)`
- `(is_active)`

### 5.4 Table: `inventory_uploads`
Represents one inventory check upload.

- `id` (uuid)
- `uploaded_at` (timestamptz)
- `uploaded_by` (uuid/text)
- `source` (text: manual_upload, scanner_export, etc.)
- `notes` (text)
- `file_attachment_id` (uuid, fk attachments, optional)

### 5.5 Table: `inventory_snapshot_lines`
One row per product per upload.

- `id` (uuid)
- `inventory_upload_id` (uuid fk)
- `product_id` (uuid fk)
- `quantity` (int)
- `recorded_at` (timestamptz)

Unique constraint:
- `(inventory_upload_id, product_id)`

### 5.6 Table: `inventory_levels`
Latest computed stock levels.

- `product_id` (uuid pk fk products)
- `quantity_on_hand` (int)
- `last_inventory_upload_id` (uuid fk inventory_uploads)
- `updated_at` (timestamptz)

### 5.7 Table: `purchase_orders`
- `id` (uuid)
- `order_number` (text, unique human-friendly, e.g. PO-2026-00012)
- `requester_name` (text)
- `activity_account` (text)
- `account_number` (text)
- `vendor_id` (uuid fk vendors)
- `status` (enum)
  - draft, submitted, approved, ordered, partially_received, received, archived, cancelled
- `reason` (text)
- `priority` (enum: normal, urgent)
- `date_placed` (date/timestamptz, auto)
- `requested_pickup_date` (date, nullable)
- `asap` (bool, default false)
- `expected_arrival_date` (date, nullable)
- `total_amount` (numeric, generated/maintained)
- `created_at`, `created_by`
- `updated_at`, `updated_by`

Indexes:
- `(status, vendor_id)`
- `(date_placed)`
- `(priority)`

### 5.8 Table: `purchase_order_lines`
- `id` (uuid)
- `purchase_order_id` (uuid fk)
- `product_id` (uuid fk products, nullable)  // allow custom items
- `custom_item_name` (text, nullable)
- `quantity` (int)
- `unit_price` (numeric)
- `line_total` (numeric) // computed or stored
- `product_link` (text, nullable)
- `notes` (text, nullable)

### 5.9 Table: `receipts`
- `id` (uuid)
- `purchase_order_id` (uuid fk)
- `received_at` (timestamptz)
- `received_by` (uuid/text)
- `notes` (text)
- `attachment_id` (uuid fk attachments, nullable)

### 5.10 Table: `receipt_lines`
- `id` (uuid)
- `receipt_id` (uuid fk)
- `purchase_order_line_id` (uuid fk)
- `quantity_received` (int)
- `is_damaged` (bool default false)
- `damage_notes` (text nullable)

### 5.11 Table: `designs`
- `id` (uuid)
- `name` (text)
- `category` (text: t-shirt, hoodie, misc, etc.)
- `status` (enum: idea, review, approved, ready_to_order, archived)
- `priority` (enum: low, normal, high)
- `preferred_vendor_id` (uuid fk vendors, nullable)
- `estimated_cost` (numeric, nullable)
- `notes` (text)
- `created_at`, `created_by`

### 5.12 Table: `design_assets`
- `id` (uuid)
- `design_id` (uuid fk)
- `type` (enum: front, back, mockup, other)
- `attachment_id` (uuid fk attachments)

### 5.13 Table: `wishlist_items`
- `id` (uuid)
- `name` (text)
- `description` (text)
- `proposed_vendor_id` (uuid fk vendors, nullable)
- `estimated_cost` (numeric, nullable)
- `priority` (enum: low, normal, high)
- `status` (enum: idea, reviewing, approved, rejected, converted)
- `notes` (text)
- `created_at`, `created_by`

### 5.14 Table: `order_prompts`
Generated after inventory upload.

- `id` (uuid)
- `inventory_upload_id` (uuid fk)
- `product_id` (uuid fk)
- `current_stock` (int)
- `on_order_qty` (int)
- `suggested_qty` (int)
- `preferred_vendor_id` (uuid fk vendors)
- `status` (enum: open, dismissed, converted_to_order)
- `created_at`

Unique constraint:
- `(inventory_upload_id, product_id)`

### 5.15 Table: `attachments`
- `id` (uuid)
- `entity_type` (text: purchase_order, purchase_order_line, receipt, design, wishlist, inventory_upload, etc.)
- `entity_id` (uuid)
- `storage_bucket` (text)
- `storage_path` (text)
- `file_name` (text)
- `mime_type` (text)
- `size_bytes` (int)
- `uploaded_at` (timestamptz)
- `uploaded_by` (uuid/text)

### 5.16 Table: `audit_log`
Append-only.

- `id` (uuid)
- `entity_type` (text)
- `entity_id` (uuid)
- `action` (text: create, update, status_change, receive, archive, etc.)
- `diff` (jsonb)
- `performed_by` (uuid/text)
- `performed_at` (timestamptz)

---

## 6. Key Workflows

### 6.1 Create Order
1. User navigates to **Orders → New Order**
2. Form pre-fills defaults from `settings`
3. User selects vendor
4. User adds line items (catalog or custom)
5. Totals compute live
6. Save as **Draft** (or Submit)

Validation:
- Quantity > 0
- Unit price ≥ 0
- Vendor required
- At least 1 line item on submit

### 6.2 Status Transitions
- Order Placed → Ordered
- Ordered → (Partially Received | Received)
- Received → Completed(move somewhere else to view)

Rules:
- Archived/cancelled orders become read-only (except admin notes)

### 6.3 Receiving
1. Open order → “Receive Items”
2. For each line item, enter received qty
3. Upload receipt/invoice optional
4. System computes:
   - If received qty < ordered qty → status = partially_received
   - Else → status = received
5. Update inventory (optional v1, recommended):
   - Increase `inventory_levels.quantity_on_hand` by received qty

### 6.4 Inventory Upload → Prompt Generation
1. User uploads inventory file or enters counts
2. System stores snapshot lines
3. System updates `inventory_levels` with latest quantities
4. System generates prompts:
   - for any product where `quantity_on_hand == 0 OR quantity_on_hand < reorder_threshold`
   - AND product is not sufficiently covered by open orders

“Open orders coverage” definition:
- Sum of remaining quantities on non-archived/non-cancelled orders for that product.

Suggested qty formula:
- `suggested_qty = max(0, par_level - (quantity_on_hand + on_order_qty))`

### 6.5 Prompt → One-Click Order Draft
From prompts list:
- User clicks “Create Order”
- System either:
  - Adds line to an existing open draft for that vendor (recommended)
  - OR creates a new draft order for that vendor
- Marks prompt as `converted_to_order`

### 6.6 Designs + Wishlist Conversion
- Wishlist item can be converted into:
  - Design entry (carrying notes/vendor/cost)
  - Order draft line (for direct procurement)
- Design can be promoted to “Ready to Order” and then converted to order draft.

---

## 7. UI / Navigation (Suggested)

Single module route example: `/products`

Tabs:
1. **Orders**
2. **Prompts**
3. **Inventory**
4. **Products (Catalog)**
5. **Vendors**
6. **Designs**
7. **Wishlist**
8. **Settings** (admin)

### 7.1 Orders UI
- Table view with filters:
  - status, vendor, date range, priority
- Quick actions:
  - View, Edit, Duplicate, Receive, Archive
- Order detail page:
  - Header, line items, attachments, audit log, receiving events

### 7.2 Prompts UI
- Cards/table grouped by vendor/category
- Displays:
  - product, current stock, on-order qty, suggested qty, last unit cost, link
- Actions:
  - Create Order, Dismiss, Edit suggested qty

### 7.3 Inventory UI
- Upload inventory check
- View last upload
- Product-level history (optional)
- “Low stock” report

### 7.4 Products (Catalog) UI
- CRUD products
- Set reorder threshold and par level
- Set preferred vendor and links

### 7.5 Vendors UI
- CRUD vendors
- Set lead time days and ordering method

### 7.6 Designs UI
- Grid view with thumbnails
- Tag priority/status
- Store front/back/mockups

### 7.7 Wishlist UI
- List with priority/status
- Convert to design or order draft

### 7.8 Settings UI
- Default requester/account/account number
- Prompt thresholds (global fallback)
- Approval toggle (future)

---

## 8. Components (Frontend)

Reusable components:
- `OrderForm` (header + line items)
- `OrderLineEditor` (qty/unit/links/notes)
- `StatusPill` (consistent status display)
- `AttachmentUploader`
- `ReceivingModal`
- `PromptCard`
- `InventoryUploadWizard`
- `DesignGallery`
- `WishlistItemRow`

---

## 9. API / Server Routes (Next.js)

Suggested routes (App Router):

- `POST /api/orders` create order
- `PATCH /api/orders/:id` update order
- `POST /api/orders/:id/submit` status transition
- `POST /api/orders/:id/receive` create receipt + receipt lines
- `POST /api/inventory/upload` create upload + snapshot lines; recompute levels + prompts
- `POST /api/prompts/:id/convert` convert to order draft
- `POST /api/attachments/sign` signed upload URL
- `GET /api/settings` / `PATCH /api/settings`

Rule of thumb:
- Client reads can be direct Supabase
- Any multi-step writes should be server-side to ensure transactional integrity

---

## 10. Data Integrity Rules

- Prevent deleting submitted/ordered/received orders; archive instead.
- Enforce line item quantity > 0.
- If `product_id` is null, `custom_item_name` must be present.
- Prompt generation must de-dupe using `(inventory_upload_id, product_id)` constraint.
- “On-order qty” should ignore archived/cancelled orders.

---

## 11. Observability / Audit

Minimum:
- Track created_by/updated_by for all entities.
- Create `audit_log` entries on:
  - order status changes
  - line item edits
  - receiving events
  - prompt conversion/dismissal
  - settings updates

---

## 12. Permission Readiness

v1:
- Allow all operations for CO-OP staff (open access)

Future:
- `viewer` (read-only)
- `staff` (create/edit drafts, receiving)
- `manager` (approve, archive)
- `admin` (settings, vendor/product management)

Implementation-ready approach:
- Add `role` column to a `users` or `members` table later.
- Wrap server-side routes with permission checks when auth is enabled.

---

## 13. Performance Considerations

- Index by status/vendor/date for order list fast filtering.
- Prompt generation should operate in a single transaction:
  - insert inventory snapshot
  - update inventory levels
  - upsert prompts
- Avoid N+1 queries in order detail:
  - fetch order + lines + receipts + attachments with joins/views.

---

## 14. Milestones

### Milestone 1 (MVP)
- Vendors CRUD
- Orders CRUD + status + archive
- Attachments on orders
- Receiving workflow
- Settings defaults in order form

### Milestone 2 (Inventory + Prompts)
- Products catalog
- Inventory upload + inventory levels
- Prompt generation + conversion to draft order

### Milestone 3 (Designs + Wishlist)
- Designs CRUD + assets
- Wishlist CRUD
- Conversion flows (wishlist → design/order)

---

## 15. Open Questions (Safe Defaults)
- Are inventory checks per-SKU always available?  
  Default: allow manual mapping (SKU or name match) during upload.
- Should receiving update inventory automatically?  
  Default: yes, with a toggle per receipt “apply to stock”.
- Should prompts aggregate into existing draft orders by vendor?  
  Default: yes; reduces order clutter.

---