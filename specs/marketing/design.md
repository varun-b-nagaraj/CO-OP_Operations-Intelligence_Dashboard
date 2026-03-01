# Design Document: Marketing Dashboard

## 1. Overview

The Marketing Dashboard is a single-page module (route: `/marketing`) inside the CO-OP Operations & Intelligence Portal. It provides:
- A calendar for past + upcoming marketing events
- Quick toggles to switch between **All Events** and **Recent Events**
- Event detail views with complete marketing context (coordination + contacts + notes + assets + outcomes)
- Reference media (images/files) attached per event
- External contact management for vendors/partners/sponsors/community

This v1 scope excludes Instagram/social integrations.

---

## 2. Design Principles

1. **Calendar-first UX**: calendar is the default landing view.
2. **Fast drill-down**: click event → open detail drawer instantly.
3. **Everything in one place**: event detail includes all notes, contacts, coordination logs, and reference media.
4. **Repeatability**: completed events should be easy to reuse as templates (duplicate event).
5. **Minimal friction**: creation/editing is lightweight, autosaves where possible, and avoids multi-step wizards.
6. **Permission-ready**: permission gates exist even if allow-all in v1.

---

## 3. Information Architecture

### Primary Route
- `/marketing`

### Tabs (top-level)
1. **Calendar** (default)
2. **Events** (list/board view)
3. **Contacts** (external people/orgs)
4. **Reports** (optional v1; basic stats table)

---

## 4. Core Screens & UI Behavior

## 4.1 Calendar Screen (Default)

### Layout
- Header row:
  - Page title: **Marketing**
  - Toggle: **All Events** | **Recent Events**
  - Search bar (search title/contact/org)
  - Button: **+ New Event**

- Main body:
  - Calendar component (Month view default)
  - Secondary controls (right side or toolbar):
    - View switch: Month | Week | List (Week/List optional)
    - Filters: Status, Category (optional but recommended)

### Calendar Item Rendering
Each event chip shows:
- Title (truncate)
- Status pill (Draft/Scheduled/Completed/Cancelled)
- Category tag (optional)
- Optional indicator icons:
  - 📎 if attachments exist
  - 👥 if external contacts linked

### Recent Events Toggle Logic
- **Recent Events** shows:
  - last 30 days (past) + next 30 days (future)
- **All Events** shows:
  - full dataset (paginated or windowed if large)

### Interaction
- Click event → opens **Event Detail Drawer**
- Click empty date cell (optional) → opens “Create Event” drawer prefilled with date

---

## 4.2 Event Detail Drawer (Primary Drill-Down)

### Drawer Structure
A right-side drawer (preferred) with:
- Sticky header:
  - Event title (editable)
  - Status dropdown
  - Actions menu: Duplicate, Archive/Delete (Delete optional in v1)
  - Close button

- Content organized into sections (accordion or tabs inside drawer)

#### Section A: Overview
Fields:
- Start datetime / End datetime
- Location
- Category
- Description
- Goals / Success Criteria
- Target audience
- Budget planned / actual (optional)
- Links (add multiple)

#### Section B: Coordinators & Contacts
Two tables/cards:

**Internal Coordinators**
- Name
- Role
- Notes

**External Contacts**
- Organization
- Person name
- Role/title
- Email
- Phone
- Notes
- Quick actions: copy email/phone, open contact record

Add external contact:
- Choose existing contact OR create new inline

#### Section C: Assets (Reference Media)
- Upload area (drag/drop + button)
- Gallery grid with thumbnails
- Each asset supports:
  - Type (Flyer/Photo/Mockup/Schedule/Other)
  - Caption/notes
  - Timestamp
- Click thumbnail → full preview modal
- “Set as Cover” action (optional)

#### Section D: Notes
- Simple notes editor (multi-line)
- Notes list (newest first)
- Each note shows author + timestamp

#### Section E: Coordination Log
- Add log entry form:
  - Contacted party (select external contact or free text)
  - Method (Email/Call/In-person/Text/Other)
  - Summary
  - Next steps + due date (optional)
- Timeline list view of entries

#### Section F: Outcomes & Stats (visible when Completed OR always visible)
- Outcome summary
- What worked / What didn’t
- Recommendations for next time
- Stats fields:
  - Estimated interactions/attendees
  - Units sold (optional)
  - Revenue impact (optional)
  - Actual cost (optional)
  - ROI notes

---

## 4.3 Events List Screen

### Purpose
A high-density view for scanning, filtering, and bulk operations.

### Layout
- Toolbar:
  - Search
  - Filters: Status, Category, Date range, Has media
  - Sort: Upcoming, Recently updated, Recently completed
  - Button: + New Event

- Table columns (recommended):
  - Date
  - Title
  - Status
  - Category
  - Location
  - Internal coordinator(s)
  - External org(s)
  - Attachments count
  - Last updated

Row click → opens Event Detail Drawer.

Optional: “Board view” by Status (Draft/Scheduled/Completed/Cancelled) as v2.

---

## 4.4 Contacts Screen

### Layout
- Left: Contacts table/list (searchable)
- Right: Contact detail panel

### Contact Fields
- Organization name
- Person name
- Role/title
- Email, Phone
- Notes
- Linked events (list of events where they appear)

### Actions
- Create contact
- Edit contact
- Merge duplicates (v2)
- Export CSV (optional)

---

## 4.5 Reports Screen (Optional v1)

### v1 Minimal
- Table of completed events with stats columns:
  - Date, Title, Category, Interactions, Cost, Notes
- Filters: date range + category
- Export CSV (optional)

---

## 5. Component Breakdown (Suggested)

### Pages / Containers
- `MarketingPage` (tabs + shared toolbar)
- `CalendarView`
- `EventsListView`
- `ContactsView`
- `ReportsView` (optional)

### Shared Components
- `EventDetailDrawer`
- `EventFormSection`
- `StatusPill`
- `CategoryTag`
- `AssetGallery` + `AssetUpload`
- `NotesPanel`
- `CoordinationLogTimeline`
- `ContactPicker` (existing/new)

### UI Patterns
- Drawer for details (keeps calendar context)
- Modal for image preview only
- Toast notifications for save/upload success/fail

---

## 6. State & Data Flow (High-Level)

### Data Loading Strategy
- Calendar view fetch:
  - date-window events (month +/- buffer)
  - includes summary fields + counts (assets count, contacts count)
- Event detail fetch:
  - full event record + joined contacts + assets + notes + logs
- Contacts view fetch:
  - contacts list + basic info
  - contact detail lazy-load linked events

### Optimistic Updates
- Title/status edits update immediately and reconcile on success.
- Notes/log entries append optimistically with pending indicator.

### Autosave (Recommended)
- For text fields, debounce save (e.g., 600–1000ms).
- For structured fields (status/category), save on change.

---

## 7. Storage & Media Design

### Requirements
- Thumbnail generation recommended (client-side preview ok in v1).
- Store assets with metadata:
  - event_id, type, caption, created_at/by
- Use signed URLs in future auth mode.

---

## 8. Empty States & Error Handling

### Empty States
- No events: show onboarding card + “Create Event”
- No recent events: explain recent window and link to All Events
- No assets: show upload call-to-action

### Error States
- Calendar load failure: retry + fallback to list view
- Upload failure: per-file retry, do not lose other uploads
- Partial data load: show skeletons + progressive fill

---

## 9. Accessibility

- Keyboard navigation for calendar and drawer
- Proper focus management:
  - opening drawer traps focus inside
  - closing drawer returns focus to selected calendar event
- Alt text for images (caption used as fallback)

---

## 10. v1 Milestones

1. Calendar view + All/Recent toggle
2. Event CRUD + status/category
3. Event detail drawer with:
   - Overview fields
   - External contacts linking
   - Assets upload + gallery
   - Notes
   - Coordination log
4. Events list screen with filters
5. Contacts screen (basic CRUD + linked events)
6. Optional reports table

---

## 11. Future Enhancements (Not in v1)

- Instagram / social metrics ingestion
- Approval workflow (draft approval)
- Template library for recurring events
- Automated post-event stats from POS/orders
- Asset versioning / brand kit enforcement