# Requirements Document: Marketing Dashboard

## 1. Overview

The Marketing Dashboard is a web module inside the CO-OP Operations & Intelligence Portal that centralizes marketing event planning and historical records. It provides a calendar view of all marketing events, detailed event pages, internal notes, attached reference media (images/files), and full coordination/contact information for internal and external collaborators.

This v1 scope intentionally excludes Instagram or social API integrations.

---

## 2. Goals

1. Provide a single source of truth for past and upcoming marketing events.
2. Enable fast lookup of event details: what happened, who coordinated, who was contacted, what assets were used, and results.
3. Store reference images/media for consistent branding and repeatability.
4. Support planning workflows (draft → scheduled → completed) with notes and post-event debrief.

---

## 3. Users & Permissions (v1 and future-ready)

### v1 (Open Access Mode)
- Any portal user can view, create, and edit marketing events and related data.

### Future (Role-Based)
- Roles may include:
  - Marketing Admin (full access)
  - Marketing Editor (create/edit; limited deletion)
  - Marketing Viewer (read-only)
- Requirement: system must be permission-ready (feature gates exist even if allow-all in v1).

---

## 4. Core Entities & Definitions

### 4.1 Marketing Event
A marketing event is a planned or completed activity intended to promote the CO-OP, increase awareness, or drive sales/engagement.

### 4.2 External Contact
An external contact is any non-CO-OP collaborator or stakeholder (e.g., vendor rep, local business, school staff outside CO-OP, sponsors).

### 4.3 Coordination
A coordination record connects an event to an internal or external party and captures how they were involved.

### 4.4 Media Asset
Images/files attached to an event for reference (flyers, photos, mockups, schedules, brand assets).

---

## 5. Functional Requirements

### 5.1 Calendar View (Primary UI)
**Requirement:** The dashboard must provide a calendar that displays marketing events.

**Calendar Modes**
- Month view (default)
- Week view (optional but recommended)
- List view (recommended for fast scanning)

**Filtering / Toggles**
- Toggle: `All Events` vs `Recent Events`
  - Recent Events definition (v1): events occurring within the last 30 days + next 30 days
  - Admin configurable in future (e.g., 14/30/60/90)

**Calendar Interactions**
- Click event → opens Event Detail panel/page
- Create event from:
  - “New Event” button
  - Clicking a date cell (pre-fills date)

**Visual Tags**
- Events should show status and type at a glance:
  - Status: Draft / Scheduled / Completed / Cancelled
  - Type: Promo table, social shoot, flyer campaign, spirit week, vendor collab, etc.
- Color coding is optional but strongly preferred.

---

### 5.2 Event Detail View
**Requirement:** Each event must have a detailed view showing all relevant information.

**Event Fields (Minimum)**
- Event title
- Start date/time
- End date/time (optional but supported)
- Location (free text + optional structured fields)
- Status (Draft / Scheduled / Completed / Cancelled)
- Event type/category (select)
- Description (what the event is)
- Goals (what success looks like)
- Target audience (students, teachers, parents, etc.)
- Budget (planned vs actual; optional but supported)
- Supplies/materials needed
- Links (forms, documents, vendor pages, folder links)

**Coordination**
- Internal coordinators:
  - Name
  - Role (e.g., marketing lead, photographer, cashier lead)
  - Contact method (email/phone if applicable)
- External coordinators / partners:
  - Organization name
  - Person name
  - Role/title
  - Email
  - Phone
  - Notes (availability, expectations, constraints)
  - Coordination log entries (see 5.4)

**Outcome / Post-Event Summary (for Completed Events)**
- Outcome summary (what happened)
- What worked / what didn’t
- Recommendations for next time
- Attachments (photos, flyers, final assets)
- Basic event statistics (see 5.6)

---

### 5.3 Media / Reference Images
**Requirement:** Users must be able to attach and view images/media files for an event.

**Capabilities**
- Upload multiple images per event
- Support common formats: PNG, JPG, HEIC (optional), PDF
- Show a gallery grid + click to full preview
- Tag assets with:
  - Asset type (Flyer, Photo, Mockup, Schedule, Other)
  - Caption/notes
  - Created date
- Allow “cover image” selection for each event (optional but recommended)

**Storage**
- Files must be stored in a managed storage system with per-file metadata and stable URLs.

---

### 5.4 Notes & Coordination Log
**Requirement:** Events must support notes and a structured coordination log.

**Notes**
- Rich text not required; plain text acceptable in v1.
- Notes can be:
  - Planning notes
  - Meeting notes
  - Debrief notes

**Coordination Log Entries**
- Timestamp
- Who logged it (internal user)
- Contacted party (internal/external reference or free text)
- Method (Email / Call / In-person / Text / Other)
- Summary of what was discussed
- Next steps + due date (optional but supported)

---

### 5.5 Search & Browsing
**Requirement:** Users must be able to find marketing events quickly.

**Search**
- Search events by:
  - Title
  - Location
  - External organization/person
  - Tags/category
  - Coordinator name

**Filters**
- Status filter
- Category filter
- Date range filter
- “Has media” filter (optional)

**Sorting**
- Upcoming first (default)
- Recently completed
- Most recently updated

---

### 5.6 Event Statistics (Manual v1)
**Requirement:** Track event “results” as structured fields (manual entry in v1).

**Stats Fields (Recommended)**
- Estimated attendees / interactions
- Units sold (if relevant)
- Revenue impact (if relevant)
- Cost (actual)
- ROI notes (free text)
- Engagement notes (qualitative)
- Photo count (auto from assets, optional)

**Important:** In v1, all statistics are manually entered and editable.

---

### 5.7 Data Quality & Auditability
**Requirement:** The system must maintain reliable change tracking.

- Track created_at, created_by
- Track updated_at, updated_by
- Optional audit log for edits/deletes (recommended for future)

---

## 6. Non-Functional Requirements

### Performance
- Calendar view should load within ~2 seconds for typical usage (hundreds of events).
- Images should load via thumbnails; full-size on demand.

### Reliability
- Uploads should be resumable or at minimum fail gracefully with retry.

### Security
- v1 allow-all, but architecture must support RLS and permission gates later.
- External contacts contain personal info → protect from public exposure (must be behind portal auth in future).

### Usability
- Event detail view must be printable/exportable (optional in v1, recommended in v2).
- “Duplicate Event” action recommended to reuse templates.

---

## 7. Out of Scope (v1)
- Instagram integration / auto-updating post metrics
- Automated analytics ingestion from platforms
- Public-facing event pages
- Complex approval workflows

---

## 8. Acceptance Criteria (v1)

1. A user can create an event and see it on the calendar.
2. Calendar toggle works:
   - All Events shows full dataset
   - Recent Events shows last 30 days + next 30 days (or defined rule)
3. Clicking an event opens a detail page/panel with all event fields.
4. User can add external contact(s) with name + organization + email/phone.
5. User can upload and view multiple images/files per event in a gallery.
6. User can add notes and coordination log entries for each event.
7. User can search events by title and by external contact/organization.
8. User can mark event as completed and fill outcome + stats fields.

---

## 9. Suggested Information Architecture (UI Tabs)

- **Calendar**
- **Events List**
- **Contacts**
- **Assets Library** (optional; can be embedded per event in v1)
- **Reports/Stats** (optional v1; basic list of completed events with stats)

---

## 10. Minimal Data Model (Implementation Hint)

- marketing_events
- marketing_event_contacts (join table)
- external_contacts
- marketing_event_assets
- marketing_event_notes
- marketing_event_coordination_logs

(Exact schema intentionally omitted here; implementation can vary.)