'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createMarketingRepository } from '@/lib/marketing/client';
import type {
  AssetType,
  CoordinationMethod,
  EventAssetRow,
  EventContactRow,
  EventNoteRow,
  ExternalContactRow,
  MarketingEventBundle,
  MarketingEventRow,
  MarketingEventStatus
} from '@/lib/marketing/types';
import { createBrowserClient } from '@/lib/supabase';

type DashboardTab = 'calendar' | 'events' | 'contacts' | 'reports';
type CalendarView = 'month' | 'list';

type EventDraft = MarketingEventRow;

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'events', label: 'Events' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'reports', label: 'Reports' }
];

const STATUS_OPTIONS: Array<{ value: MarketingEventStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' }
];

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: 'flyer', label: 'Flyer' },
  { value: 'photo', label: 'Photo' },
  { value: 'mockup', label: 'Mockup' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'other', label: 'Other' }
];

const METHODS: Array<{ value: CoordinationMethod; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'in_person', label: 'In-person' },
  { value: 'text', label: 'Text' }
];

const STATUS_CLASSES: Record<MarketingEventStatus, string> = {
  draft: 'border border-neutral-300 bg-neutral-100 text-neutral-700',
  scheduled: 'border border-sky-300 bg-sky-100 text-sky-700',
  completed: 'border border-emerald-300 bg-emerald-100 text-emerald-700',
  cancelled: 'border border-red-300 bg-red-100 text-red-700'
};

interface PendingAssetPreview {
  id: string;
  previewUrl: string;
  fileName: string;
  assetType: AssetType;
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function toInputDateTime(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoFromInput(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseCurrencyInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMonthGrid(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  const end = new Date(lastDay);
  end.setDate(lastDay.getDate() + (6 - lastDay.getDay()));

  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function dateKey(value: Date | string) {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameMonth(date: Date, monthAnchor: Date) {
  return date.getMonth() === monthAnchor.getMonth() && date.getFullYear() === monthAnchor.getFullYear();
}

function toEventSavePayload(draft: EventDraft) {
  return {
    id: draft.id,
    title: draft.title,
    status: draft.status,
    category: draft.category,
    starts_at: draft.starts_at,
    ends_at: draft.ends_at,
    location: draft.location,
    description: draft.description,
    goals: draft.goals,
    target_audience: draft.target_audience,
    budget_planned: draft.budget_planned,
    budget_actual: draft.budget_actual,
    links: draft.links,
    outcome_summary: draft.outcome_summary,
    what_worked: draft.what_worked,
    what_didnt: draft.what_didnt,
    recommendations: draft.recommendations,
    estimated_interactions: draft.estimated_interactions,
    units_sold: draft.units_sold,
    cost_roi_notes: draft.cost_roi_notes,
    cover_asset_id: draft.cover_asset_id
  };
}

export function MarketingDashboard() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const repository = useMemo(() => createMarketingRepository(supabase), [supabase]);

  const [activeTab, setActiveTab] = useState<DashboardTab>('calendar');
  const [recentOnly, setRecentOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [statusFilter, setStatusFilter] = useState<'all' | MarketingEventStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [events, setEvents] = useState<MarketingEventRow[]>([]);
  const [contacts, setContacts] = useState<ExternalContactRow[]>([]);
  const [reports, setReports] = useState<MarketingEventRow[]>([]);
  const [eventIndicators, setEventIndicators] = useState<
    Record<string, { assets: number; internalContacts: number; externalContacts: number }>
  >({});

  const [loading, setLoading] = useState(true);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventBundle, setEventBundle] = useState<MarketingEventBundle | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autosaveRef = useRef<number | null>(null);

  const [linksInput, setLinksInput] = useState('');
  const [newInternalCoordinator, setNewInternalCoordinator] = useState({
    coordinatorName: '',
    coordinatorRole: '',
    coordinatorNotes: ''
  });
  const [newContactDraft, setNewContactDraft] = useState({
    organization: '',
    person_name: '',
    role_title: '',
    email: '',
    phone: '',
    notes: ''
  });
  const [selectedContactToLink, setSelectedContactToLink] = useState('');

  const [newNote, setNewNote] = useState('');
  const [newCoordination, setNewCoordination] = useState({
    contactedParty: '',
    method: 'email' as CoordinationMethod,
    summary: '',
    nextSteps: ''
  });

  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContactEventIds, setSelectedContactEventIds] = useState<string[]>([]);

  const [reportSearch, setReportSearch] = useState('');

  const [pendingAssetPreviews, setPendingAssetPreviews] = useState<PendingAssetPreview[]>([]);
  const [assetDraftType, setAssetDraftType] = useState<AssetType>('photo');
  const [assetDraftCaption, setAssetDraftCaption] = useState('');
  const [previewAsset, setPreviewAsset] = useState<EventAssetRow | null>(null);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    events.forEach((event) => {
      if (event.category?.trim()) values.add(event.category.trim());
    });
    return ['all', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [events]);

  const calendarGrid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const filteredEventsByDay = useMemo(() => {
    const byDay = new Map<string, MarketingEventRow[]>();
    events.forEach((event) => {
      const key = dateKey(event.starts_at);
      const bucket = byDay.get(key) ?? [];
      bucket.push(event);
      byDay.set(key, bucket);
    });
    return byDay;
  }, [events]);

  const selectedContact = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find((entry) => entry.id === selectedContactId) ?? null;
  }, [contacts, selectedContactId]);

  const selectedContactLinkedEvents = useMemo(() => {
    if (!selectedContact) return [];
    const idSet = new Set(selectedContactEventIds);
    return events.filter((event) => idSet.has(event.id));
  }, [events, selectedContact, selectedContactEventIds]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventRows, contactRows, reportRows] = await Promise.all([
        repository.listEvents({
          recentOnly,
          query: searchQuery,
          status: statusFilter,
          category: categoryFilter
        }),
        repository.listContacts(contactSearch),
        repository.listReportRows(reportSearch)
      ]);

      setEvents(eventRows);
      setContacts(contactRows);
      setReports(reportRows);
      if (eventRows.length) {
        const indicators = await repository.listEventIndicators(eventRows.map((row) => row.id));
        setEventIndicators(indicators);
      } else {
        setEventIndicators({});
      }

      if (selectedContactId && !contactRows.some((entry) => entry.id === selectedContactId)) {
        setSelectedContactId(contactRows[0]?.id ?? null);
      } else if (!selectedContactId && contactRows[0]?.id) {
        setSelectedContactId(contactRows[0].id);
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load marketing dashboard.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [repository, recentOnly, searchQuery, statusFilter, categoryFilter, contactSearch, reportSearch, selectedContactId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const run = async () => {
      if (!selectedContactId) {
        setSelectedContactEventIds([]);
        return;
      }
      try {
        const linked = await repository.listLinkedEventIdsForContact(selectedContactId);
        setSelectedContactEventIds(linked);
      } catch {
        setSelectedContactEventIds([]);
      }
    };
    void run();
  }, [repository, selectedContactId]);

  const loadEventBundle = useCallback(
    async (eventId: string) => {
      setLoadingDrawer(true);
      setError(null);
      try {
        const bundle = await repository.getEventBundle(eventId);
        setEventBundle(bundle);
        setEventDraft(bundle.event);
        setLinksInput(bundle.event.links.join('\n'));
        setSelectedEventId(eventId);
        setDrawerOpen(true);
        setSelectedContactToLink('');
      } catch (bundleError) {
        const message = bundleError instanceof Error ? bundleError.message : 'Unable to open event details.';
        setError(message);
      } finally {
        setLoadingDrawer(false);
      }
    },
    [repository]
  );

  const createEvent = useCallback(
    async (day?: Date) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const start = day ? new Date(day) : new Date();
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setHours(11, 0, 0, 0);

        const created = await repository.saveEvent({
          title: 'New Event',
          status: 'draft',
          category: null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          location: null,
          description: null,
          goals: null,
          target_audience: null,
          budget_planned: null,
          budget_actual: null,
          links: [],
          outcome_summary: null,
          what_worked: null,
          what_didnt: null,
          recommendations: null,
          estimated_interactions: null,
          units_sold: null,
          cost_roi_notes: null,
          cover_asset_id: null
        });

        setEvents((prev) => [created, ...prev]);
        setNotice('Event created.');
        await loadEventBundle(created.id);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : 'Failed to create event.';
        setError(message);
      } finally {
        setSaving(false);
      }
    },
    [loadEventBundle, repository]
  );

  const commitAutosave = useCallback(
    async (draft: EventDraft) => {
      try {
        setAutosaveState('saving');
        const saved = await repository.saveEvent(toEventSavePayload(draft));
        setEvents((prev) => prev.map((entry) => (entry.id === saved.id ? saved : entry)));
        setEventBundle((prev) => (prev ? { ...prev, event: saved } : prev));
        setEventDraft(saved);
        setAutosaveState('saved');
      } catch (saveError) {
        setAutosaveState('error');
        const message = saveError instanceof Error ? saveError.message : 'Autosave failed.';
        setError(message);
      }
    },
    [repository]
  );

  const queueAutosave = useCallback(
    (nextDraft: EventDraft) => {
      setEventDraft(nextDraft);
      setEvents((prev) => prev.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry)));
      setEventBundle((prev) => (prev ? { ...prev, event: nextDraft } : prev));
      setAutosaveState('saving');

      if (autosaveRef.current !== null) {
        window.clearTimeout(autosaveRef.current);
      }

      autosaveRef.current = window.setTimeout(() => {
        void commitAutosave(nextDraft);
      }, 650);
    },
    [commitAutosave]
  );

  useEffect(() => {
    return () => {
      if (autosaveRef.current !== null) {
        window.clearTimeout(autosaveRef.current);
      }
      pendingAssetPreviews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));
    };
  }, [pendingAssetPreviews]);

  const onDraftFieldChange = (field: keyof EventDraft, value: EventDraft[keyof EventDraft]) => {
    if (!eventDraft) return;
    queueAutosave({ ...eventDraft, [field]: value });
  };

  const onLinksInputChange = (value: string) => {
    setLinksInput(value);
    if (!eventDraft) return;
    const parsed = value
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
    queueAutosave({ ...eventDraft, links: parsed });
  };

  const onAssetFilesSelected = async (files: FileList | File[]) => {
    if (!selectedEventId) return;
    const list = Array.from(files);
    if (!list.length) return;

    const previews = list.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}`,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
      assetType: assetDraftType
    }));

    setPendingAssetPreviews((prev) => [...previews, ...prev]);

    try {
      const uploaded: EventAssetRow[] = [];
      for (const file of list) {
        const row = await repository.uploadAsset({
          eventId: selectedEventId,
          file,
          assetType: assetDraftType,
          caption: assetDraftCaption.trim() || null
        });
        uploaded.push(row);
      }

      setEventBundle((prev) => (prev ? { ...prev, assets: [...uploaded, ...prev.assets] } : prev));
      setNotice('Assets uploaded.');
      setAssetDraftCaption('');
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Asset upload failed.';
      setError(message);
    } finally {
      setPendingAssetPreviews((prev) => {
        prev.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
        return [];
      });
    }
  };

  const onDropZoneFiles = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void onAssetFilesSelected(event.dataTransfer.files);
  };

  const addInternalCoordinator = async () => {
    if (!selectedEventId || !newInternalCoordinator.coordinatorName.trim()) return;

    try {
      const row = await repository.addInternalCoordinator({
        eventId: selectedEventId,
        coordinatorName: newInternalCoordinator.coordinatorName.trim(),
        coordinatorRole: newInternalCoordinator.coordinatorRole.trim() || null,
        coordinatorNotes: newInternalCoordinator.coordinatorNotes.trim() || null
      });
      setEventBundle((prev) => (prev ? { ...prev, eventContacts: [row, ...prev.eventContacts] } : prev));
      setNewInternalCoordinator({ coordinatorName: '', coordinatorRole: '', coordinatorNotes: '' });
    } catch (coordinatorError) {
      const message = coordinatorError instanceof Error ? coordinatorError.message : 'Unable to add coordinator.';
      setError(message);
    }
  };

  const createAndLinkContact = async () => {
    if (!selectedEventId || !newContactDraft.organization.trim() || !newContactDraft.person_name.trim()) return;

    try {
      const created = await repository.saveContact({
        organization: newContactDraft.organization.trim(),
        person_name: newContactDraft.person_name.trim(),
        role_title: newContactDraft.role_title.trim() || null,
        email: newContactDraft.email.trim() || null,
        phone: newContactDraft.phone.trim() || null,
        notes: newContactDraft.notes.trim() || null
      });

      const linked = await repository.linkExternalContact({
        eventId: selectedEventId,
        contactId: created.id
      });

      setContacts((prev) => {
        const exists = prev.some((entry) => entry.id === created.id);
        return exists ? prev : [created, ...prev];
      });
      setEventBundle((prev) => (prev ? { ...prev, eventContacts: [linked, ...prev.eventContacts] } : prev));
      setNewContactDraft({ organization: '', person_name: '', role_title: '', email: '', phone: '', notes: '' });
    } catch (contactError) {
      const message = contactError instanceof Error ? contactError.message : 'Unable to create contact.';
      setError(message);
    }
  };

  const linkExistingContact = async () => {
    if (!selectedEventId || !selectedContactToLink) return;
    try {
      const linked = await repository.linkExternalContact({
        eventId: selectedEventId,
        contactId: selectedContactToLink
      });
      setEventBundle((prev) => (prev ? { ...prev, eventContacts: [linked, ...prev.eventContacts] } : prev));
      setSelectedContactToLink('');
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : 'Unable to link contact.';
      setError(message);
    }
  };

  const removeEventContact = async (eventContactId: string) => {
    try {
      await repository.unlinkEventContact(eventContactId);
      setEventBundle((prev) =>
        prev
          ? {
              ...prev,
              eventContacts: prev.eventContacts.filter((entry) => entry.id !== eventContactId)
            }
          : prev
      );
    } catch (unlinkError) {
      const message = unlinkError instanceof Error ? unlinkError.message : 'Unable to remove contact link.';
      setError(message);
    }
  };

  const addNote = async () => {
    if (!selectedEventId || !newNote.trim()) return;
    try {
      const row = await repository.addEventNote({
        eventId: selectedEventId,
        note: newNote.trim(),
        author: 'dashboard'
      });
      setEventBundle((prev) => (prev ? { ...prev, notes: [row, ...prev.notes] } : prev));
      setNewNote('');
    } catch (noteError) {
      const message = noteError instanceof Error ? noteError.message : 'Unable to add note.';
      setError(message);
    }
  };

  const addCoordinationEntry = async () => {
    if (!selectedEventId || !newCoordination.contactedParty.trim() || !newCoordination.summary.trim()) return;
    try {
      const row = await repository.addCoordinationLog({
        eventId: selectedEventId,
        contactedParty: newCoordination.contactedParty.trim(),
        method: newCoordination.method,
        summary: newCoordination.summary.trim(),
        nextSteps: newCoordination.nextSteps.trim() || null,
        createdBy: 'dashboard'
      });
      setEventBundle((prev) => (prev ? { ...prev, coordinationLogs: [row, ...prev.coordinationLogs] } : prev));
      setNewCoordination({ contactedParty: '', method: 'email', summary: '', nextSteps: '' });
    } catch (coordinationError) {
      const message = coordinationError instanceof Error ? coordinationError.message : 'Unable to add coordination entry.';
      setError(message);
    }
  };

  const setCoverAsset = async (assetId: string) => {
    if (!selectedEventId || !eventDraft) return;
    setEventBundle((prev) =>
      prev
        ? {
            ...prev,
            assets: prev.assets.map((asset) => ({ ...asset, is_cover: asset.id === assetId }))
          }
        : prev
    );
    queueAutosave({ ...eventDraft, cover_asset_id: assetId });

    try {
      await repository.setCoverAsset({ eventId: selectedEventId, assetId });
      setNotice('Cover image updated.');
    } catch (coverError) {
      const message = coverError instanceof Error ? coverError.message : 'Unable to set cover image.';
      setError(message);
    }
  };

  const monthHeading = useMemo(() => {
    return monthAnchor.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric'
    });
  }, [monthAnchor]);

  const visibleEventRows = events;

  if (loading) {
    return (
      <main className="min-h-screen w-full">
        <section className="w-full border border-neutral-300 bg-white">
          <div className="animate-pulse border-b border-neutral-300 px-4 py-4 md:px-6">
            <div className="h-5 w-40 bg-neutral-200" />
            <div className="mt-2 h-4 w-72 bg-neutral-100" />
          </div>
          <div className="animate-pulse space-y-3 p-4 md:p-6">
            <div className="h-10 w-full bg-neutral-100" />
            <div className="h-64 w-full bg-neutral-100" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full text-neutral-900">
      <section className="w-full border border-neutral-300 bg-white">
        {(error || notice) && (
          <section className="border-b border-neutral-300 px-4 py-3 md:px-6">
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
          </section>
        )}

        <header className="border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">Marketing</h1>
              <p className="mt-1 text-sm text-neutral-600">Manage marketing events, assets, and coordination.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex border border-neutral-300 bg-white text-sm">
                <button
                  className={`min-h-[38px] px-3 ${!recentOnly ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'}`}
                  onClick={() => setRecentOnly(false)}
                  type="button"
                >
                  All Events
                </button>
                <button
                  className={`min-h-[38px] border-l border-neutral-300 px-3 ${recentOnly ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'}`}
                  onClick={() => setRecentOnly(true)}
                  type="button"
                >
                  Recent Events
                </button>
              </div>

              <input
                className="min-h-[38px] w-[240px] border border-neutral-300 bg-white px-3 text-sm"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search events"
                value={searchQuery}
              />

              <button
                className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000] disabled:opacity-60"
                disabled={saving}
                onClick={() => {
                  void createEvent();
                }}
                type="button"
              >
                + New Event
              </button>
            </div>
          </div>
        </header>

        <nav className="overflow-x-auto border-b border-neutral-300 bg-neutral-50" role="tablist" aria-label="Marketing tabs">
          <div className="flex min-w-max">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  aria-selected={isActive}
                  role="tab"
                  className={`border-r border-neutral-300 px-4 py-2 text-sm ${isActive ? 'bg-white font-semibold' : 'bg-neutral-50 text-neutral-700'}`}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <section className="space-y-3 p-4 md:space-y-4 md:p-6">
          {activeTab === 'calendar' && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border border-neutral-300 bg-white p-3">
                <div className="flex items-center gap-2">
                  <button
                    className="min-h-[34px] border border-neutral-300 bg-white px-3 text-sm"
                    onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    type="button"
                  >
                    Prev
                  </button>
                  <p className="text-sm font-semibold">{monthHeading}</p>
                  <button
                    className="min-h-[34px] border border-neutral-300 bg-white px-3 text-sm"
                    onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    type="button"
                  >
                    Next
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex border border-neutral-300 bg-white text-sm">
                    <button
                      className={`min-h-[34px] px-3 ${calendarView === 'month' ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'}`}
                      onClick={() => setCalendarView('month')}
                      type="button"
                    >
                      Month
                    </button>
                    <button
                      className={`min-h-[34px] border-l border-neutral-300 px-3 ${calendarView === 'list' ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'}`}
                      onClick={() => setCalendarView('list')}
                      type="button"
                    >
                      List
                    </button>
                  </div>

                  <select
                    className="min-h-[34px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setStatusFilter(event.target.value as 'all' | MarketingEventStatus)}
                    value={statusFilter}
                  >
                    <option value="all">All Statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>

                  <select
                    className="min-h-[34px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setCategoryFilter(event.target.value)}
                    value={categoryFilter}
                  >
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === 'all' ? 'All Categories' : option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {events.length === 0 ? (
                <div className="border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
                  <p className="text-sm text-neutral-700">No events yet. Create your first event.</p>
                  <button
                    className="mt-3 min-h-[38px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white"
                    onClick={() => {
                      void createEvent();
                    }}
                    type="button"
                  >
                    Create your first event
                  </button>
                </div>
              ) : null}

              {calendarView === 'month' ? (
                <div className="grid grid-cols-7 border border-neutral-300 bg-white">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => (
                    <div key={name} className="border-b border-r border-neutral-300 bg-neutral-50 px-2 py-2 text-xs font-medium text-neutral-600 last:border-r-0">
                      {name}
                    </div>
                  ))}

                  {calendarGrid.map((day) => {
                    const key = dateKey(day);
                    const dayEvents = filteredEventsByDay.get(key) ?? [];
                    const inCurrentMonth = isSameMonth(day, monthAnchor);
                    return (
                      <div
                        key={key}
                        className={`min-h-[124px] border-r border-b border-neutral-300 p-2 last:border-r-0 ${inCurrentMonth ? 'bg-white' : 'bg-neutral-50'}`}
                      >
                        <button
                          className="mb-2 text-left text-xs font-medium text-neutral-700 underline-offset-2 hover:underline"
                          onClick={() => {
                            void createEvent(day);
                          }}
                          type="button"
                        >
                          {day.getDate()}
                        </button>

                        <div className="space-y-1">
                          {dayEvents.slice(0, 3).map((event) => {
                            const hasImages = (eventIndicators[event.id]?.assets ?? 0) > 0;
                            const hasExternalContacts = (eventIndicators[event.id]?.externalContacts ?? 0) > 0;
                            return (
                              <button
                                key={event.id}
                                className="flex w-full items-center justify-between gap-1 border border-neutral-200 bg-neutral-50 px-2 py-1 text-left text-[11px]"
                                onClick={() => {
                                  void loadEventBundle(event.id);
                                }}
                                type="button"
                              >
                                <span className="truncate">{event.title}</span>
                                <span className="flex items-center gap-1">
                                  {hasImages ? <span className="text-neutral-600">IMG</span> : null}
                                  {hasExternalContacts ? <span className="text-neutral-600">EXT</span> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-auto border border-neutral-300 bg-white">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="border-b border-neutral-300 px-3 py-2">Date</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Title</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Status</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Category</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEventRows.map((event) => (
                        <tr key={event.id}>
                          <td className="border-b border-neutral-200 px-3 py-2">{formatDate(event.starts_at)}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">
                            <button
                              className="text-left underline-offset-2 hover:underline"
                              onClick={() => {
                                void loadEventBundle(event.id);
                              }}
                              type="button"
                            >
                              {event.title}
                            </button>
                          </td>
                          <td className="border-b border-neutral-200 px-3 py-2">
                            <span className={`inline-flex px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status]}`}>{formatLabel(event.status)}</span>
                          </td>
                          <td className="border-b border-neutral-200 px-3 py-2">{event.category ?? 'Uncategorized'}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{event.location ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'events' && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border border-neutral-300 bg-white p-3">
                <input
                  className="min-h-[36px] w-[240px] border border-neutral-300 px-2 text-sm"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search"
                  value={searchQuery}
                />
                <select
                  className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                  onChange={(event) => setStatusFilter(event.target.value as 'all' | MarketingEventStatus)}
                  value={statusFilter}
                >
                  <option value="all">All Statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <select
                  className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  value={categoryFilter}
                >
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === 'all' ? 'All Categories' : option}
                    </option>
                  ))}
                </select>
                <select className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm" defaultValue="starts_at_desc">
                  <option value="starts_at_desc">Sort: Newest</option>
                  <option value="starts_at_asc">Sort: Oldest</option>
                </select>
              </div>

              <div className="overflow-auto border border-neutral-300 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="border-b border-neutral-300 px-3 py-2">Date</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Title</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Status</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Category</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Location</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Coordinators</th>
                      <th className="border-b border-neutral-300 px-3 py-2">External Orgs</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Attachments</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEventRows.map((event) => {
                      const internalCount = eventIndicators[event.id]?.internalContacts ?? 0;
                      const externalOrgs = eventIndicators[event.id]?.externalContacts ?? 0;
                      const attachmentCount = eventIndicators[event.id]?.assets ?? 0;

                      return (
                        <tr key={event.id}>
                          <td className="border-b border-neutral-200 px-3 py-2">{formatDate(event.starts_at)}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">
                            <button
                              className="text-left underline-offset-2 hover:underline"
                              onClick={() => {
                                void loadEventBundle(event.id);
                              }}
                              type="button"
                            >
                              {event.title}
                            </button>
                          </td>
                          <td className="border-b border-neutral-200 px-3 py-2">
                            <span className={`inline-flex px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status]}`}>{formatLabel(event.status)}</span>
                          </td>
                          <td className="border-b border-neutral-200 px-3 py-2">{event.category ?? '-'}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{event.location ?? '-'}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{internalCount}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{externalOrgs}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{attachmentCount}</td>
                          <td className="border-b border-neutral-200 px-3 py-2">{formatDateTime(event.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'contacts' && (
            <section className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
              <div className="border border-neutral-300 bg-white">
                <div className="border-b border-neutral-300 p-3">
                  <input
                    className="min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setContactSearch(event.target.value)}
                    placeholder="Search contacts"
                    value={contactSearch}
                  />
                </div>

                <div className="max-h-[62vh] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="border-b border-neutral-300 px-3 py-2">Organization</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Name</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Role</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact) => {
                        const isSelected = selectedContactId === contact.id;
                        return (
                          <tr
                            key={contact.id}
                            className={isSelected ? 'bg-neutral-100' : ''}
                            onClick={() => setSelectedContactId(contact.id)}
                          >
                            <td className="border-b border-neutral-200 px-3 py-2">{contact.organization}</td>
                            <td className="border-b border-neutral-200 px-3 py-2">{contact.person_name}</td>
                            <td className="border-b border-neutral-200 px-3 py-2">{contact.role_title ?? '-'}</td>
                            <td className="border-b border-neutral-200 px-3 py-2">{contact.email ?? '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="border border-neutral-300 bg-white p-3">
                {!selectedContact ? (
                  <p className="text-sm text-neutral-600">Select a contact to view details.</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    <h3 className="text-base font-semibold">Contact Details</h3>
                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">Organization:</span> {selectedContact.organization}
                      </p>
                      <p>
                        <span className="font-medium">Person:</span> {selectedContact.person_name}
                      </p>
                      <p>
                        <span className="font-medium">Role:</span> {selectedContact.role_title ?? '-'}
                      </p>
                      <p>
                        <span className="font-medium">Email:</span> {selectedContact.email ?? '-'}
                      </p>
                      <p>
                        <span className="font-medium">Phone:</span> {selectedContact.phone ?? '-'}
                      </p>
                      <p>
                        <span className="font-medium">Notes:</span> {selectedContact.notes ?? '-'}
                      </p>
                    </div>

                    <div className="border-t border-neutral-300 pt-3">
                      <p className="mb-2 text-sm font-medium">Linked Events</p>
                      {selectedContactLinkedEvents.length ? (
                        <ul className="space-y-1">
                          {selectedContactLinkedEvents.map((event) => (
                            <li key={event.id}>
                              <button
                                className="text-left underline-offset-2 hover:underline"
                                onClick={() => {
                                  void loadEventBundle(event.id);
                                }}
                                type="button"
                              >
                                {event.title} ({formatDate(event.starts_at)})
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-neutral-600">No linked events.</p>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </section>
          )}

          {activeTab === 'reports' && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border border-neutral-300 bg-white p-3">
                <input
                  className="min-h-[36px] w-[260px] border border-neutral-300 px-2 text-sm"
                  onChange={(event) => setReportSearch(event.target.value)}
                  placeholder="Filter completed events"
                  value={reportSearch}
                />
                <select className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm" defaultValue="all_categories">
                  <option value="all_categories">All Categories</option>
                </select>
                <button className="min-h-[36px] border border-neutral-300 bg-white px-3 text-sm text-neutral-500" disabled type="button">
                  Export CSV (Coming Soon)
                </button>
              </div>

              <div className="overflow-auto border border-neutral-300 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="border-b border-neutral-300 px-3 py-2">Date</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Title</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Category</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Interations</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Cost</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((entry) => (
                      <tr key={entry.id}>
                        <td className="border-b border-neutral-200 px-3 py-2">{formatDate(entry.starts_at)}</td>
                        <td className="border-b border-neutral-200 px-3 py-2">{entry.title}</td>
                        <td className="border-b border-neutral-200 px-3 py-2">{entry.category ?? '-'}</td>
                        <td className="border-b border-neutral-200 px-3 py-2">{entry.estimated_interactions ?? '-'}</td>
                        <td className="border-b border-neutral-200 px-3 py-2">
                          {entry.budget_actual !== null ? `$${entry.budget_actual.toFixed(2)}` : '-'}
                        </td>
                        <td className="border-b border-neutral-200 px-3 py-2">{entry.outcome_summary ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </section>

      {drawerOpen && (
        <>
          <button
            className="fixed inset-0 z-40 bg-black/25"
            onClick={() => setDrawerOpen(false)}
            type="button"
            aria-label="Close drawer"
          />

          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-[980px] overflow-y-auto border-l border-neutral-300 bg-white shadow-[0_0_24px_rgba(0,0,0,0.15)]">
            {loadingDrawer || !eventDraft || !eventBundle ? (
              <div className="animate-pulse space-y-3 p-4 md:p-6">
                <div className="h-6 w-56 bg-neutral-200" />
                <div className="h-24 w-full bg-neutral-100" />
                <div className="h-24 w-full bg-neutral-100" />
              </div>
            ) : (
              <div className="p-4 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-300 pb-3">
                  <div>
                    <h2 className="text-lg font-semibold">Event Details</h2>
                    <p className="mt-1 text-xs text-neutral-600">Autosave: {autosaveState}</p>
                  </div>
                  <button
                    className="min-h-[36px] border border-neutral-300 bg-white px-3 text-sm"
                    onClick={() => setDrawerOpen(false)}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-5 py-4">
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Overview</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Title</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('title', event.target.value)}
                          value={eventDraft.title}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Category</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('category', event.target.value || null)}
                          value={eventDraft.category ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Date & Time (Start)</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('starts_at', toIsoFromInput(event.target.value) ?? eventDraft.starts_at)}
                          type="datetime-local"
                          value={toInputDateTime(eventDraft.starts_at)}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Date & Time (End)</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('ends_at', toIsoFromInput(event.target.value))}
                          type="datetime-local"
                          value={toInputDateTime(eventDraft.ends_at)}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Location</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('location', event.target.value || null)}
                          value={eventDraft.location ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Status</span>
                        <select
                          className="min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                          onChange={(event) => onDraftFieldChange('status', event.target.value as MarketingEventStatus)}
                          value={eventDraft.status}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="md:col-span-2 text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Description</span>
                        <textarea
                          className="min-h-[80px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('description', event.target.value || null)}
                          value={eventDraft.description ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Goals / Success Criteria</span>
                        <textarea
                          className="min-h-[80px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('goals', event.target.value || null)}
                          value={eventDraft.goals ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Target Audience</span>
                        <textarea
                          className="min-h-[80px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('target_audience', event.target.value || null)}
                          value={eventDraft.target_audience ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Budget Planned</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('budget_planned', parseCurrencyInput(event.target.value))}
                          placeholder="0.00"
                          value={eventDraft.budget_planned ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Budget Actual</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('budget_actual', parseCurrencyInput(event.target.value))}
                          placeholder="0.00"
                          value={eventDraft.budget_actual ?? ''}
                        />
                      </label>

                      <label className="md:col-span-2 text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Links (one per line)</span>
                        <textarea
                          className="min-h-[72px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onLinksInputChange(event.target.value)}
                          value={linksInput}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-neutral-300 pt-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Coordinators & Contacts</h3>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-2 border border-neutral-300 p-3">
                        <p className="text-sm font-medium">Internal Coordinators</p>
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) =>
                            setNewInternalCoordinator((prev) => ({ ...prev, coordinatorName: event.target.value }))
                          }
                          placeholder="Name"
                          value={newInternalCoordinator.coordinatorName}
                        />
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) =>
                            setNewInternalCoordinator((prev) => ({ ...prev, coordinatorRole: event.target.value }))
                          }
                          placeholder="Role"
                          value={newInternalCoordinator.coordinatorRole}
                        />
                        <textarea
                          className="min-h-[58px] w-full border border-neutral-300 px-2 py-2 text-sm"
                          onChange={(event) =>
                            setNewInternalCoordinator((prev) => ({ ...prev, coordinatorNotes: event.target.value }))
                          }
                          placeholder="Notes"
                          value={newInternalCoordinator.coordinatorNotes}
                        />
                        <button
                          className="min-h-[34px] border border-neutral-700 bg-neutral-800 px-3 text-sm text-white"
                          onClick={() => {
                            void addInternalCoordinator();
                          }}
                          type="button"
                        >
                          Add Internal Coordinator
                        </button>
                      </div>

                      <div className="space-y-2 border border-neutral-300 p-3">
                        <p className="text-sm font-medium">External Contacts</p>
                        <div className="flex gap-2">
                          <select
                            className="min-h-[34px] flex-1 border border-neutral-300 bg-white px-2 text-sm"
                            onChange={(event) => setSelectedContactToLink(event.target.value)}
                            value={selectedContactToLink}
                          >
                            <option value="">Select existing contact</option>
                            {contacts.map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {contact.organization} - {contact.person_name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="min-h-[34px] border border-neutral-700 bg-neutral-800 px-3 text-sm text-white"
                            onClick={() => {
                              void linkExistingContact();
                            }}
                            type="button"
                          >
                            Link
                          </button>
                        </div>

                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, organization: event.target.value }))}
                          placeholder="Organization"
                          value={newContactDraft.organization}
                        />
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, person_name: event.target.value }))}
                          placeholder="Person Name"
                          value={newContactDraft.person_name}
                        />
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, role_title: event.target.value }))}
                          placeholder="Role/Title"
                          value={newContactDraft.role_title}
                        />
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, email: event.target.value }))}
                          placeholder="Email"
                          value={newContactDraft.email}
                        />
                        <input
                          className="min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, phone: event.target.value }))}
                          placeholder="Phone"
                          value={newContactDraft.phone}
                        />
                        <textarea
                          className="min-h-[58px] w-full border border-neutral-300 px-2 py-2 text-sm"
                          onChange={(event) => setNewContactDraft((prev) => ({ ...prev, notes: event.target.value }))}
                          placeholder="Notes"
                          value={newContactDraft.notes}
                        />
                        <button
                          className="min-h-[34px] border border-neutral-700 bg-neutral-800 px-3 text-sm text-white"
                          onClick={() => {
                            void createAndLinkContact();
                          }}
                          type="button"
                        >
                          Create & Link Contact
                        </button>
                      </div>
                    </div>

                    <div className="overflow-auto border border-neutral-300">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-neutral-50">
                          <tr>
                            <th className="border-b border-neutral-300 px-2 py-2">Type</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Name/Person</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Organization</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Role</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Email</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Phone</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Notes</th>
                            <th className="border-b border-neutral-300 px-2 py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eventBundle.eventContacts.map((entry: EventContactRow) => (
                            <tr key={entry.id}>
                              <td className="border-b border-neutral-200 px-2 py-2">{entry.is_internal ? 'Internal' : 'External'}</td>
                              <td className="border-b border-neutral-200 px-2 py-2">
                                {entry.is_internal ? entry.coordinator_name ?? '-' : entry.contact?.person_name ?? '-'}
                              </td>
                              <td className="border-b border-neutral-200 px-2 py-2">{entry.contact?.organization ?? '-'}</td>
                              <td className="border-b border-neutral-200 px-2 py-2">
                                {entry.is_internal ? entry.coordinator_role ?? '-' : entry.contact?.role_title ?? '-'}
                              </td>
                              <td className="border-b border-neutral-200 px-2 py-2">{entry.contact?.email ?? '-'}</td>
                              <td className="border-b border-neutral-200 px-2 py-2">{entry.contact?.phone ?? '-'}</td>
                              <td className="border-b border-neutral-200 px-2 py-2">
                                {entry.is_internal ? entry.coordinator_notes ?? '-' : entry.contact?.notes ?? '-'}
                              </td>
                              <td className="border-b border-neutral-200 px-2 py-2">
                                <button
                                  className="border border-neutral-400 bg-white px-2 py-1"
                                  onClick={() => {
                                    void removeEventContact(entry.id);
                                  }}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-neutral-300 pt-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Assets (Reference Media)</h3>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <input
                        className="min-h-[34px] border border-neutral-300 px-2 text-sm"
                        onChange={(event) => setAssetDraftCaption(event.target.value)}
                        placeholder="Caption"
                        value={assetDraftCaption}
                      />
                      <select
                        className="min-h-[34px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setAssetDraftType(event.target.value as AssetType)}
                        value={assetDraftType}
                      >
                        {ASSET_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex min-h-[34px] items-center border border-neutral-700 bg-neutral-800 px-3 text-sm text-white">
                        Upload
                        <input
                          className="hidden"
                          multiple
                          onChange={(event) => {
                            if (event.target.files) {
                              void onAssetFilesSelected(event.target.files);
                              event.target.value = '';
                            }
                          }}
                          type="file"
                        />
                      </label>
                    </div>

                    <div
                      className="flex min-h-[96px] items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 p-3 text-center text-sm text-neutral-600"
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDrop={onDropZoneFiles}
                    >
                      Drag and drop files here to upload
                    </div>

                    {eventBundle.assets.length === 0 && pendingAssetPreviews.length === 0 ? (
                      <div className="border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-sm text-neutral-600">
                        No assets uploaded yet. Add flyers, photos, mockups, or schedules.
                      </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {pendingAssetPreviews.map((preview) => (
                        <div key={preview.id} className="border border-neutral-300 bg-white p-2">
                          <div className="h-24 w-full bg-neutral-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={preview.fileName} className="h-full w-full object-cover" src={preview.previewUrl} />
                          </div>
                          <p className="mt-1 truncate text-xs text-neutral-700">{preview.fileName}</p>
                          <p className="text-[11px] text-neutral-500">Uploading...</p>
                        </div>
                      ))}

                      {eventBundle.assets.map((asset) => {
                        const { data } = supabase.storage.from(asset.bucket).getPublicUrl(asset.storage_path);
                        return (
                          <div key={asset.id} className="border border-neutral-300 bg-white p-2">
                            <button
                              className="h-24 w-full bg-neutral-100"
                              onClick={() => setPreviewAsset(asset)}
                              type="button"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img alt={asset.file_name} className="h-full w-full object-cover" src={data.publicUrl} />
                            </button>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="inline-flex border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[11px]">
                                {formatLabel(asset.asset_type)}
                              </span>
                              <button
                                className="text-[11px] underline-offset-2 hover:underline"
                                onClick={() => {
                                  void setCoverAsset(asset.id);
                                }}
                                type="button"
                              >
                                {asset.is_cover ? 'Cover' : 'Set Cover'}
                              </button>
                            </div>
                            <p className="mt-1 truncate text-xs text-neutral-600">{asset.caption ?? '-'}</p>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-neutral-300 pt-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Notes</h3>
                    <div className="flex gap-2">
                      <textarea
                        className="min-h-[64px] flex-1 border border-neutral-300 px-2 py-2 text-sm"
                        onChange={(event) => setNewNote(event.target.value)}
                        placeholder="Add note"
                        value={newNote}
                      />
                      <button
                        className="min-h-[34px] self-start border border-neutral-700 bg-neutral-800 px-3 text-sm text-white"
                        onClick={() => {
                          void addNote();
                        }}
                        type="button"
                      >
                        Add Note
                      </button>
                    </div>
                    <div className="space-y-2">
                      {eventBundle.notes.map((note: EventNoteRow) => (
                        <div key={note.id} className="border border-neutral-300 bg-white p-2">
                          <p className="text-sm">{note.note}</p>
                          <p className="mt-1 text-xs text-neutral-600">
                            {note.author ?? 'Unknown'} - {formatDateTime(note.created_at)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-neutral-300 pt-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Coordination Log</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        className="min-h-[34px] border border-neutral-300 px-2 text-sm"
                        onChange={(event) => setNewCoordination((prev) => ({ ...prev, contactedParty: event.target.value }))}
                        placeholder="Contacted party"
                        value={newCoordination.contactedParty}
                      />
                      <select
                        className="min-h-[34px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setNewCoordination((prev) => ({ ...prev, method: event.target.value as CoordinationMethod }))}
                        value={newCoordination.method}
                      >
                        {METHODS.map((method) => (
                          <option key={method.value} value={method.value}>
                            {method.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className="min-h-[64px] border border-neutral-300 px-2 py-2 text-sm"
                        onChange={(event) => setNewCoordination((prev) => ({ ...prev, summary: event.target.value }))}
                        placeholder="Summary"
                        value={newCoordination.summary}
                      />
                      <textarea
                        className="min-h-[64px] border border-neutral-300 px-2 py-2 text-sm"
                        onChange={(event) => setNewCoordination((prev) => ({ ...prev, nextSteps: event.target.value }))}
                        placeholder="Next steps"
                        value={newCoordination.nextSteps}
                      />
                    </div>
                    <button
                      className="min-h-[34px] border border-neutral-700 bg-neutral-800 px-3 text-sm text-white"
                      onClick={() => {
                        void addCoordinationEntry();
                      }}
                      type="button"
                    >
                      Add Log Entry
                    </button>

                    <div className="space-y-2">
                      {eventBundle.coordinationLogs.map((entry) => (
                        <div key={entry.id} className="border border-neutral-300 bg-white p-2 text-sm">
                          <p>
                            <span className="font-medium">{entry.contacted_party}</span> via {formatLabel(entry.method)}
                          </p>
                          <p className="mt-1">{entry.summary}</p>
                          <p className="mt-1 text-neutral-700">Next: {entry.next_steps ?? '-'}</p>
                          <p className="mt-1 text-xs text-neutral-600">{formatDateTime(entry.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2 border-t border-neutral-300 pt-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Outcomes & Stats</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm md:col-span-2">
                        <span className="mb-1 block text-xs text-neutral-600">Outcome Summary</span>
                        <textarea
                          className="min-h-[70px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('outcome_summary', event.target.value || null)}
                          value={eventDraft.outcome_summary ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">What Worked</span>
                        <textarea
                          className="min-h-[70px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('what_worked', event.target.value || null)}
                          value={eventDraft.what_worked ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">What Didn&apos;t</span>
                        <textarea
                          className="min-h-[70px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('what_didnt', event.target.value || null)}
                          value={eventDraft.what_didnt ?? ''}
                        />
                      </label>

                      <label className="text-sm md:col-span-2">
                        <span className="mb-1 block text-xs text-neutral-600">Recommendations</span>
                        <textarea
                          className="min-h-[70px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('recommendations', event.target.value || null)}
                          value={eventDraft.recommendations ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Estimated Interactions</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('estimated_interactions', parseIntegerInput(event.target.value))}
                          value={eventDraft.estimated_interactions ?? ''}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1 block text-xs text-neutral-600">Units Sold (optional)</span>
                        <input
                          className="min-h-[36px] w-full border border-neutral-300 px-2"
                          onChange={(event) => onDraftFieldChange('units_sold', parseIntegerInput(event.target.value))}
                          value={eventDraft.units_sold ?? ''}
                        />
                      </label>

                      <label className="text-sm md:col-span-2">
                        <span className="mb-1 block text-xs text-neutral-600">Cost & ROI Notes</span>
                        <textarea
                          className="min-h-[70px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => onDraftFieldChange('cost_roi_notes', event.target.value || null)}
                          value={eventDraft.cost_roi_notes ?? ''}
                        />
                      </label>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {previewAsset && (
        <div className="fixed inset-0 z-[70] bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="mx-auto max-w-4xl border border-neutral-300 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">{previewAsset.file_name}</p>
              <button className="border border-neutral-300 bg-white px-2 py-1 text-sm" onClick={() => setPreviewAsset(null)} type="button">
                Close
              </button>
            </div>
            <div className="max-h-[80vh] overflow-auto border border-neutral-200 bg-neutral-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={previewAsset.file_name}
                className="mx-auto h-auto max-h-[76vh] w-auto"
                src={supabase.storage.from(previewAsset.bucket).getPublicUrl(previewAsset.storage_path).data.publicUrl}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
