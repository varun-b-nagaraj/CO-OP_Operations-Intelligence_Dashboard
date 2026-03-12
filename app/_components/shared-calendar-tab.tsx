'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { createBrowserClient } from '@/lib/supabase';

type CalendarEntryType = 'event' | 'target' | 'reminder';
type CalendarMode = 'calendar' | 'list';
type ModalMode = 'create' | 'edit';

interface AccessRoleOption {
  role_key: string;
  role_name: string;
}

interface CalendarEventRow {
  id: string;
  title: string;
  details: string | null;
  entry_type: CalendarEntryType;
  starts_at: string;
  ends_at: string | null;
  view_for_everyone: boolean;
  visible_role_keys: string[];
  source_department: string | null;
  inventory_signup_enabled: boolean;
}

interface CalendarEventDraft {
  title: string;
  details: string;
  entry_type: CalendarEntryType;
  starts_at: string;
  ends_at: string;
  view_for_everyone: boolean;
  visible_role_keys: string[];
  source_department: string;
  inventory_signup_enabled: boolean;
}

interface InventoryCheckEventState {
  id: string;
  calendar_event_id: string;
  signup_state: 'none' | 'signed_up' | 'withdrawn' | 'requested_change';
  can_self_withdraw: boolean;
}

const ENTRY_TYPE_OPTIONS: Array<{ value: CalendarEntryType; label: string }> = [
  { value: 'event', label: 'Event' },
  { value: 'target', label: 'Target' },
  { value: 'reminder', label: 'Reminder' }
];

const DAY_PAGE_SIZE = 3;

const ENTRY_TYPE_PILL_CLASS: Record<CalendarEntryType, string> = {
  event: 'border-rose-200 bg-rose-50 text-rose-700',
  target: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  reminder: 'border-violet-200 bg-violet-50 text-violet-700'
};

const VISIBILITY_PILL_CLASS = {
  everyone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  restricted: 'border-amber-200 bg-amber-50 text-amber-700'
} as const;

const DEPARTMENT_COLOR_BY_KEY: Record<string, { label: string; boxClass: string; pillClass: string }> = {
  lightspeed: {
    label: 'Lightspeed',
    boxClass: 'border-orange-200 bg-orange-50',
    pillClass: 'border-orange-200 bg-orange-100 text-orange-700'
  },
  marketing: {
    label: 'Marketing',
    boxClass: 'border-pink-200 bg-pink-50',
    pillClass: 'border-pink-200 bg-pink-100 text-pink-700'
  },
  inventory: {
    label: 'Inventory',
    boxClass: 'border-teal-200 bg-teal-50',
    pillClass: 'border-teal-200 bg-teal-100 text-teal-700'
  },
  kiosk: {
    label: 'Kiosk',
    boxClass: 'border-cyan-200 bg-cyan-50',
    pillClass: 'border-cyan-200 bg-cyan-100 text-cyan-700'
  },
  cfa: {
    label: 'Chick-fil-A Operations',
    boxClass: 'border-red-200 bg-red-50',
    pillClass: 'border-red-200 bg-red-100 text-red-700'
  },
  finance: {
    label: 'Finance',
    boxClass: 'border-emerald-200 bg-emerald-50',
    pillClass: 'border-emerald-200 bg-emerald-100 text-emerald-700'
  },
  product: {
    label: 'Product',
    boxClass: 'border-indigo-200 bg-indigo-50',
    pillClass: 'border-indigo-200 bg-indigo-100 text-indigo-700'
  },
  hr: {
    label: 'Human Resources (HR)',
    boxClass: 'border-lime-200 bg-lime-50',
    pillClass: 'border-lime-200 bg-lime-100 text-lime-700'
  },
  unknown: {
    label: 'General',
    boxClass: 'border-neutral-200 bg-neutral-50',
    pillClass: 'border-neutral-200 bg-neutral-100 text-neutral-700'
  }
};

const DEPARTMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'lightspeed', label: 'Lightspeed' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'kiosk', label: 'Kiosk' },
  { value: 'cfa', label: 'Chick-fil-A Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'product', label: 'Product' },
  { value: 'hr', label: 'Human Resources (HR)' }
];

function toLocalInputDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));

  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function createDraftForDay(day?: Date, sourceDepartment?: string) {
  const start = day ? new Date(day) : new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return {
    title: '',
    details: '',
    entry_type: 'event' as CalendarEntryType,
    starts_at: toLocalInputDateTime(start.toISOString()),
    ends_at: toLocalInputDateTime(end.toISOString()),
    view_for_everyone: true,
    visible_role_keys: [],
    source_department: sourceDepartment ?? '',
    inventory_signup_enabled: false
  };
}

function createDraftFromEvent(entry: CalendarEventRow): CalendarEventDraft {
  return {
    title: entry.title,
    details: entry.details ?? '',
    entry_type: entry.entry_type,
    starts_at: toLocalInputDateTime(entry.starts_at),
    ends_at: toLocalInputDateTime(entry.ends_at ?? ''),
    view_for_everyone: entry.view_for_everyone !== false,
    visible_role_keys: Array.isArray(entry.visible_role_keys) ? entry.visible_role_keys : [],
    source_department: normalizeDepartmentKey(entry.source_department),
    inventory_signup_enabled: Boolean(entry.inventory_signup_enabled)
  };
}

function normalizeDepartmentKey(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
  if (!normalized) return 'unknown';
  if (normalized.includes('lightspeed') || normalized.includes('website')) return 'lightspeed';
  if (normalized.includes('marketing')) return 'marketing';
  if (normalized.includes('inventory')) return 'inventory';
  if (normalized.includes('kiosk')) return 'kiosk';
  if (normalized === 'cfa' || normalized.includes('chick') || normalized.includes('fil a')) return 'cfa';
  if (normalized.includes('finance')) return 'finance';
  if (normalized.includes('product')) return 'product';
  if (normalized === 'hr' || normalized.includes('human resources') || normalized.includes('employee')) return 'hr';
  return 'unknown';
}

function getDepartmentStyle(sourceDepartment: string | null | undefined) {
  const key = normalizeDepartmentKey(sourceDepartment);
  return DEPARTMENT_COLOR_BY_KEY[key] ?? DEPARTMENT_COLOR_BY_KEY.unknown;
}

export function SharedCalendarTab(props: { sourceDepartment: string }) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [mode, setMode] = useState<CalendarMode>('calendar');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [entryTypeFilter, setEntryTypeFilter] = useState<'all' | CalendarEntryType>('all');
  const [dayPageByKey, setDayPageByKey] = useState<Record<string, number>>({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [expandedListEventId, setExpandedListEventId] = useState<string | null>(null);
  const [listEditDraft, setListEditDraft] = useState<CalendarEventDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inventoryCheckByEventId, setInventoryCheckByEventId] = useState<Record<string, InventoryCheckEventState>>({});
  const [createAsInventoryCheck, setCreateAsInventoryCheck] = useState(false);
  const [requestReasonByCheckId, setRequestReasonByCheckId] = useState<Record<string, string>>({});
  const [availableRoles, setAvailableRoles] = useState<AccessRoleOption[]>([]);
  const [currentUserRoleKeys, setCurrentUserRoleKeys] = useState<string[]>([]);

  const defaultDepartment = useMemo(() => {
    const normalized = normalizeDepartmentKey(props.sourceDepartment);
    return normalized === 'unknown' ? '' : normalized;
  }, [props.sourceDepartment]);

  const [draft, setDraft] = useState<CalendarEventDraft>(() => {
    const normalized = normalizeDepartmentKey(props.sourceDepartment);
    return createDraftForDay(undefined, normalized === 'unknown' ? '' : normalized);
  });

  const loadInventoryChecks = useCallback(async () => {
    try {
      const response = await fetch('/api/inventory/checks', { cache: 'no-store' });
      if (!response.ok) {
        setInventoryCheckByEventId({});
        return;
      }
      const payload = (await response.json()) as { ok?: boolean; checks?: Array<Record<string, unknown>> };
      if (!payload.ok || !Array.isArray(payload.checks)) {
        setInventoryCheckByEventId({});
        return;
      }
      const next: Record<string, InventoryCheckEventState> = {};
      for (const row of payload.checks) {
        const eventId = String(row.calendar_event_id ?? '');
        const checkId = String(row.id ?? '');
        if (!eventId || !checkId) continue;
        next[eventId] = {
          id: checkId,
          calendar_event_id: eventId,
          signup_state:
            (String(row.signup_state ?? 'none') as InventoryCheckEventState['signup_state']) ?? 'none',
          can_self_withdraw: Boolean(row.can_self_withdraw)
        };
      }
      setInventoryCheckByEventId(next);
    } catch {
      setInventoryCheckByEventId({});
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const { data, error } = await supabase
      .from('general_department_calendar_events')
      .select('id,title,details,entry_type,starts_at,ends_at,view_for_everyone,visible_role_keys,source_department,inventory_signup_enabled')
      .order('starts_at', { ascending: true })
      .limit(1000);

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const normalizedRows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.title ?? ''),
      details: row.details ? String(row.details) : null,
      entry_type: String(row.entry_type ?? 'event') as CalendarEntryType,
      starts_at: String(row.starts_at ?? ''),
      ends_at: row.ends_at ? String(row.ends_at) : null,
      view_for_everyone: row.view_for_everyone !== false,
      visible_role_keys: Array.isArray(row.visible_role_keys)
        ? row.visible_role_keys.map((entry) => String(entry)).filter(Boolean)
        : [],
      source_department: row.source_department ? String(row.source_department) : null,
      inventory_signup_enabled: Boolean(row.inventory_signup_enabled)
    })) as CalendarEventRow[];
    setEvents(normalizedRows);
    void loadInventoryChecks();
    setLoading(false);
  }, [loadInventoryChecks, supabase]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void fetch('/api/access/visibility', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          ok?: boolean;
          roles?: AccessRoleOption[];
          user_role_keys?: string[];
        };
        if (!payload.ok) return;
        setAvailableRoles(Array.isArray(payload.roles) ? payload.roles : []);
        setCurrentUserRoleKeys(Array.isArray(payload.user_role_keys) ? payload.user_role_keys : []);
      })
      .catch(() => undefined);
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((entry) => {
      if (entryTypeFilter !== 'all' && entry.entry_type !== entryTypeFilter) return false;
      if (entry.view_for_everyone) return true;
      if (entry.visible_role_keys.length === 0) return false;
      return entry.visible_role_keys.some((roleKey) => currentUserRoleKeys.includes(roleKey));
    });
  }, [currentUserRoleKeys, entryTypeFilter, events]);

  const toggleDraftRole = useCallback((roleKey: string, checked: boolean) => {
    setDraft((prev) => {
      const nextRoles = checked
        ? Array.from(new Set([...prev.visible_role_keys, roleKey]))
        : prev.visible_role_keys.filter((entry) => entry !== roleKey);
      return {
        ...prev,
        visible_role_keys: nextRoles
      };
    });
  }, []);

  const toggleListEditRole = useCallback((roleKey: string, checked: boolean) => {
    setListEditDraft((prev) => {
      if (!prev) return prev;
      const nextRoles = checked
        ? Array.from(new Set([...prev.visible_role_keys, roleKey]))
        : prev.visible_role_keys.filter((entry) => entry !== roleKey);
      return {
        ...prev,
        visible_role_keys: nextRoles
      };
    });
  }, []);

  useEffect(() => {
    setDayPageByKey({});
  }, [filteredEvents, monthAnchor]);

  const openCreateModal = useCallback((day?: Date) => {
    setDraft((prev) => {
      const nextDraft = createDraftForDay(day, defaultDepartment);
      return {
        ...nextDraft,
        entry_type: prev.entry_type,
        view_for_everyone: prev.view_for_everyone,
        visible_role_keys: prev.visible_role_keys,
        source_department: prev.source_department || defaultDepartment
      };
    });
    setModalMode('create');
    setEditingEventId(null);
    setCreateModalOpen(true);
    setCreateAsInventoryCheck(props.sourceDepartment === 'inventory');
    setMessage(null);
  }, [defaultDepartment, props.sourceDepartment]);

  const openEditModal = useCallback((entry: CalendarEventRow) => {
    setDraft(createDraftFromEvent(entry));
    setModalMode('edit');
    setEditingEventId(entry.id);
    setCreateModalOpen(true);
    setMessage(null);
  }, []);

  const openListEditor = useCallback((entry: CalendarEventRow) => {
    const isClosing = expandedListEventId === entry.id;
    setExpandedListEventId(isClosing ? null : entry.id);
    setListEditDraft(isClosing ? null : createDraftFromEvent(entry));
    setMessage(null);
  }, [expandedListEventId]);

  const saveEntry = async (options?: { closeImmediately?: boolean }) => {
    if (options?.closeImmediately) {
      setCreateModalOpen(false);
    }

    const title = draft.title.trim();
    if (!title) {
      setMessage('Title is required.');
      return;
    }

    const startsAt = toIso(draft.starts_at);
    if (!startsAt) {
      setMessage('Start date/time is required.');
      return;
    }
    if (!draft.view_for_everyone && draft.visible_role_keys.length === 0) {
      setMessage('Select at least one role when "View for everyone" is disabled.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const payload = {
      title,
      details: draft.details.trim() || null,
      entry_type: draft.entry_type,
      starts_at: startsAt,
      ends_at: toIso(draft.ends_at),
      view_for_everyone: draft.view_for_everyone,
      visible_role_keys: draft.view_for_everyone ? [] : draft.visible_role_keys,
      source_department: draft.source_department || defaultDepartment || props.sourceDepartment || null
    };

    let error: { message: string } | null = null;
    if (modalMode === 'create' && createAsInventoryCheck && payload.source_department === 'inventory' && payload.entry_type === 'event') {
      const response = await fetch('/api/inventory/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          details: payload.details,
          starts_at: payload.starts_at,
          ends_at: payload.ends_at,
          priority: 'employee'
        })
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        error = { message: result.error ?? 'Unable to create inventory check' };
      }
    } else {
      const result =
        modalMode === 'edit' && editingEventId
          ? await supabase
              .from('general_department_calendar_events')
              .update(payload)
              .eq('id', editingEventId)
          : await supabase.from('general_department_calendar_events').insert({
              ...payload,
              created_by: 'department_dashboard'
            });
      error = result.error ? { message: result.error.message } : null;
    }
    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    setDraft(createDraftForDay(undefined, defaultDepartment));
    setCreateModalOpen(false);
    setModalMode('create');
    setEditingEventId(null);
    setMessage(modalMode === 'edit' ? 'Calendar entry updated.' : 'Calendar entry created.');
    setSaving(false);
    await loadEvents();
  };

  const runInventoryAction = async (entry: CalendarEventRow, action: 'signup' | 'withdraw' | 'request') => {
    const check = inventoryCheckByEventId[entry.id];
    if (!check) return;
    const requestReason = requestReasonByCheckId[check.id]?.trim();
    let endpoint = `/api/inventory/checks/${check.id}/signup`;
    let body: Record<string, unknown> | undefined;
    if (action === 'withdraw') endpoint = `/api/inventory/checks/${check.id}/withdraw`;
    if (action === 'request') {
      endpoint = `/api/inventory/checks/${check.id}/requests`;
      body = {
        request_type: check.signup_state === 'signed_up' ? 'drop' : 'add',
        reason: requestReason || 'Submitted from shared calendar'
      };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? 'Request failed');
    }
    await loadInventoryChecks();
    setMessage(
      action === 'signup'
        ? 'Signed up for inventory check.'
        : action === 'withdraw'
          ? 'Removed from inventory check.'
          : 'Change request submitted.'
    );
  };

  const renderInventoryActions = (entry: CalendarEventRow) => {
    if (normalizeDepartmentKey(entry.source_department) !== 'inventory') return null;
    const state = inventoryCheckByEventId[entry.id];
    if (!state) return null;

    if (state.signup_state === 'requested_change') {
      return <p className="mt-1 text-[11px] text-amber-700">Pending change request.</p>;
    }

    if (state.signup_state === 'signed_up' && state.can_self_withdraw) {
      return (
        <button
          className="mt-1 border border-neutral-400 px-1.5 py-0.5 text-[10px]"
          onClick={(event) => {
            event.stopPropagation();
            void runInventoryAction(entry, 'withdraw').catch((error) =>
              setMessage(error instanceof Error ? error.message : 'Unable to remove signup.')
            );
          }}
          type="button"
        >
          Remove
        </button>
      );
    }

    if (state.signup_state === 'signed_up') {
      return (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-[10px] text-amber-700">24h lock active.</p>
          <input
            className="min-h-[24px] border border-neutral-300 px-1 text-[10px]"
            onChange={(event) =>
              setRequestReasonByCheckId((prev) => ({ ...prev, [state.id]: event.target.value }))
            }
            placeholder="Reason"
            value={requestReasonByCheckId[state.id] ?? ''}
          />
          <button
            className="border border-neutral-400 px-1.5 py-0.5 text-[10px]"
            onClick={(event) => {
              event.stopPropagation();
              void runInventoryAction(entry, 'request').catch((error) =>
                setMessage(error instanceof Error ? error.message : 'Unable to submit request.')
              );
            }}
            type="button"
          >
            Request Drop
          </button>
        </div>
      );
    }

    return (
      <button
        className="mt-1 border border-brand-maroon bg-brand-maroon px-1.5 py-0.5 text-[10px] text-white"
        onClick={(event) => {
          event.stopPropagation();
          void runInventoryAction(entry, 'signup').catch((error) =>
            setMessage(error instanceof Error ? error.message : 'Unable to sign up.')
          );
        }}
        type="button"
      >
        Sign Up
      </button>
    );
  };

  const deleteEntry = async () => {
    if (!editingEventId) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.from('general_department_calendar_events').delete().eq('id', editingEventId);
    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setCreateModalOpen(false);
    setModalMode('create');
    setEditingEventId(null);
    setDraft(createDraftForDay(undefined, defaultDepartment));
    setMessage('Calendar entry deleted.');
    await loadEvents();
  };

  const saveListEntry = async () => {
    if (!expandedListEventId || !listEditDraft) return;
    const title = listEditDraft.title.trim();
    if (!title) {
      setMessage('Title is required.');
      return;
    }
    const startsAt = toIso(listEditDraft.starts_at);
    if (!startsAt) {
      setMessage('Start date/time is required.');
      return;
    }
    if (!listEditDraft.view_for_everyone && listEditDraft.visible_role_keys.length === 0) {
      setMessage('Select at least one role when "View for everyone" is disabled.');
      return;
    }

    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from('general_department_calendar_events')
      .update({
        title,
        details: listEditDraft.details.trim() || null,
        entry_type: listEditDraft.entry_type,
        starts_at: startsAt,
        ends_at: toIso(listEditDraft.ends_at),
        view_for_everyone: listEditDraft.view_for_everyone,
        visible_role_keys: listEditDraft.view_for_everyone ? [] : listEditDraft.visible_role_keys,
        source_department: listEditDraft.source_department || defaultDepartment || null
      })
      .eq('id', expandedListEventId);

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setMessage('Calendar entry updated.');
    await loadEvents();
  };

  const deleteListEntry = async () => {
    if (!expandedListEventId) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.from('general_department_calendar_events').delete().eq('id', expandedListEventId);
    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setExpandedListEventId(null);
    setListEditDraft(null);
    setMessage('Calendar entry deleted.');
    await loadEvents();
  };

  const moveEntryToDay = async (entryId: string, targetDay: Date) => {
    const entry = events.find((event) => event.id === entryId);
    if (!entry) return;

    const start = new Date(entry.starts_at);
    if (Number.isNaN(start.getTime())) return;
    const nextStart = new Date(targetDay);
    nextStart.setHours(start.getHours(), start.getMinutes(), 0, 0);

    let nextEndIso: string | null = null;
    if (entry.ends_at) {
      const end = new Date(entry.ends_at);
      if (!Number.isNaN(end.getTime())) {
        const duration = Math.max(end.getTime() - start.getTime(), 15 * 60_000);
        const nextEnd = new Date(nextStart.getTime() + duration);
        nextEndIso = nextEnd.toISOString();
      }
    }

    const { error } = await supabase
      .from('general_department_calendar_events')
      .update({
        starts_at: nextStart.toISOString(),
        ends_at: nextEndIso
      })
      .eq('id', entryId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setEvents((prev) =>
      prev.map((event) =>
        event.id === entryId
          ? {
              ...event,
              starts_at: nextStart.toISOString(),
              ends_at: nextEndIso
            }
          : event
      )
    );
    setMessage('Event moved to new date.');
  };

  const grid = useMemo(() => monthGrid(monthAnchor), [monthAnchor]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    filteredEvents.forEach((entry) => {
      const key = dayKey(new Date(entry.starts_at));
      const bucket = map.get(key) ?? [];
      bucket.push(entry);
      map.set(key, bucket);
    });
    return map;
  }, [filteredEvents]);

  const upcomingEvents = useMemo(
    () => [...filteredEvents].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [filteredEvents]
  );

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            className={`min-h-[36px] border px-3 text-sm ${mode === 'calendar' ? 'border-brand-maroon bg-brand-maroon text-white' : 'border-neutral-300 bg-white'}`}
            onClick={() => setMode('calendar')}
            type="button"
          >
            Calendar Mode
          </button>
          <button
            className={`min-h-[36px] border px-3 text-sm ${mode === 'list' ? 'border-brand-maroon bg-brand-maroon text-white' : 'border-neutral-300 bg-white'}`}
            onClick={() => setMode('list')}
            type="button"
          >
            List Mode
          </button>
        </div>

        {mode === 'calendar' ? (
          <div className="flex items-center gap-2">
            <button
              className="min-h-[34px] border border-neutral-300 px-2 text-sm"
              onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              type="button"
            >
              Prev
            </button>
            <span className="text-sm font-medium">
              {monthAnchor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button
              className="min-h-[34px] border border-neutral-300 px-2 text-sm"
              onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              type="button"
            >
              Next
            </button>
            <button
              className="min-h-[34px] border border-neutral-300 px-2 text-sm"
              onClick={() => setMonthAnchor(new Date())}
              type="button"
            >
              Today
            </button>
          </div>
        ) : (
          <button
            className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => openCreateModal()}
            type="button"
          >
            Create New Event
          </button>
        )}
      </div>

      <div className="grid gap-2 border border-neutral-300 bg-white p-3 md:grid-cols-1">
        <label className="text-sm">
          Filter by event type
          <select
            className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
            onChange={(event) => setEntryTypeFilter(event.target.value as 'all' | CalendarEntryType)}
            value={entryTypeFilter}
          >
            <option value="all">All Types</option>
            {ENTRY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? <p className="text-sm text-brand-maroon">{message}</p> : null}
      {loading ? <p className="text-sm text-neutral-600">Loading calendar...</p> : null}

      {mode === 'calendar' ? (
        <div className="grid grid-cols-7 border border-neutral-300 text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="border-b border-r border-neutral-300 bg-neutral-100 p-2 font-semibold last:border-r-0">
              {day}
            </div>
          ))}
          {grid.map((day, index) => {
            const key = dayKey(day);
            const entries = eventsByDay.get(key) ?? [];
            const inMonth = day.getMonth() === monthAnchor.getMonth();
            const totalPages = Math.max(Math.ceil(entries.length / DAY_PAGE_SIZE), 1);
            const currentPage = Math.min(dayPageByKey[key] ?? 0, totalPages - 1);
            const pageStart = currentPage * DAY_PAGE_SIZE;
            const pagedEntries = entries.slice(pageStart, pageStart + DAY_PAGE_SIZE);
            return (
              <div
                key={`${key}-${index}`}
                className={`min-h-[120px] cursor-pointer border-b border-r border-neutral-300 p-2 last:border-r-0 ${inMonth ? 'bg-white' : 'bg-neutral-50 text-neutral-500'}`}
                onClick={() => openCreateModal(day)}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const entryId = event.dataTransfer.getData('text/calendar-event-id') || draggedEventId;
                  if (entryId) {
                    void moveEntryToDay(entryId, day);
                  }
                  setDraggedEventId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCreateModal(day);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-semibold">{day.getDate()}</p>
                  {entries.length > DAY_PAGE_SIZE ? (
                    <div className="flex items-center gap-1">
                      <button
                        aria-label="Previous events"
                        className="inline-flex h-5 w-5 items-center justify-center border border-neutral-300 bg-white text-[10px] hover:bg-neutral-100"
                        disabled={currentPage === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDayPageByKey((prev) => ({ ...prev, [key]: Math.max((prev[key] ?? 0) - 1, 0) }));
                        }}
                        type="button"
                      >
                        ‹
                      </button>
                      <button
                        aria-label="Next events"
                        className="inline-flex h-5 w-5 items-center justify-center border border-neutral-300 bg-white text-[10px] hover:bg-neutral-100"
                        disabled={currentPage >= totalPages - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDayPageByKey((prev) => ({ ...prev, [key]: Math.min((prev[key] ?? 0) + 1, totalPages - 1) }));
                        }}
                        type="button"
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-1 space-y-1">
                  {pagedEntries.map((entry) => (
                    <button
                      key={entry.id}
                      className={`w-full rounded border px-1 py-1 text-left text-[11px] ${getDepartmentStyle(entry.source_department).boxClass}`}
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.setData('text/calendar-event-id', entry.id);
                        setDraggedEventId(entry.id);
                      }}
                      onDragEnd={() => setDraggedEventId(null)}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditModal(entry);
                      }}
                      type="button"
                    >
                      <p className="truncate font-medium text-neutral-800">{entry.title}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${ENTRY_TYPE_PILL_CLASS[entry.entry_type]}`}>
                          {ENTRY_TYPE_OPTIONS.find((item) => item.value === entry.entry_type)?.label ?? entry.entry_type}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.view_for_everyone ? VISIBILITY_PILL_CLASS.everyone : VISIBILITY_PILL_CLASS.restricted
                          }`}
                        >
                          {entry.view_for_everyone ? 'Everyone' : 'Role restricted'}
                        </span>
                      </div>
                      {renderInventoryActions(entry)}
                    </button>
                  ))}
                  {entries.length > DAY_PAGE_SIZE ? (
                    <p className="text-[11px] text-neutral-600">
                      Page {currentPage + 1}/{totalPages}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-neutral-300">
          <table className="min-w-full text-sm"><thead className="bg-neutral-100"><tr><th className="border-b border-neutral-300 p-2 text-left">Title</th><th className="border-b border-neutral-300 p-2 text-left">Type</th><th className="border-b border-neutral-300 p-2 text-left">Starts</th><th className="border-b border-neutral-300 p-2 text-left">Ends</th><th className="border-b border-neutral-300 p-2 text-left">Visibility</th><th className="border-b border-neutral-300 p-2 text-left">Source</th></tr></thead><tbody>
              {upcomingEvents.map((entry) => (
                <Fragment key={entry.id}>
                <tr className="cursor-pointer border-b border-neutral-200 hover:bg-neutral-50"><td className="p-2"><button
                      className="text-left font-medium underline-offset-2 hover:underline"
                      onClick={() => openListEditor(entry)}
                      type="button"
                    >
                      {entry.title}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${ENTRY_TYPE_PILL_CLASS[entry.entry_type]}`}>
                        {ENTRY_TYPE_OPTIONS.find((item) => item.value === entry.entry_type)?.label ?? entry.entry_type}
                      </span>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          entry.view_for_everyone ? VISIBILITY_PILL_CLASS.everyone : VISIBILITY_PILL_CLASS.restricted
                        }`}
                      >
                        {entry.view_for_everyone ? 'Everyone' : 'Role restricted'}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">{entry.details ?? '-'}</p>
                    {renderInventoryActions(entry)}
                  </td><td className="p-2">{ENTRY_TYPE_OPTIONS.find((item) => item.value === entry.entry_type)?.label ?? entry.entry_type}</td><td className="p-2">{formatDateTime(entry.starts_at)}</td><td className="p-2">{formatDateTime(entry.ends_at)}</td><td className="p-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${entry.view_for_everyone ? VISIBILITY_PILL_CLASS.everyone : VISIBILITY_PILL_CLASS.restricted}`}>
                      {entry.view_for_everyone ? 'Everyone' : `Roles (${entry.visible_role_keys.length})`}
                    </span>
                  </td><td className="p-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getDepartmentStyle(entry.source_department).pillClass}`}>
                      {getDepartmentStyle(entry.source_department).label}
                    </span>
                  </td></tr>
                {expandedListEventId === entry.id && listEditDraft ? (
                  <tr className="border-b border-neutral-300 bg-neutral-50"><td className="p-3" colSpan={6}><div className="grid gap-2 md:grid-cols-3">
                        <label className="text-xs font-medium text-neutral-700">
                          Title
                          <input
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                            value={listEditDraft.title}
                          />
                        </label>
                        <label className="text-xs font-medium text-neutral-700">
                          Type
                          <select
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, entry_type: event.target.value as CalendarEntryType } : prev))}
                            value={listEditDraft.entry_type}
                          >
                            {ENTRY_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-neutral-700">
                          Visibility
                          <div className="mt-1 space-y-2 border border-neutral-300 p-2">
                            <label className="flex items-center gap-2 text-xs text-neutral-700">
                              <input
                                checked={listEditDraft.view_for_everyone}
                                onChange={(event) =>
                                  setListEditDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          view_for_everyone: event.target.checked,
                                          visible_role_keys: event.target.checked ? [] : prev.visible_role_keys
                                        }
                                      : prev
                                  )
                                }
                                type="checkbox"
                              />
                              View for everyone
                            </label>
                            {!listEditDraft.view_for_everyone ? (
                              <div className="max-h-28 overflow-y-auto border border-neutral-200 bg-white p-1.5">
                                {availableRoles.map((role) => (
                                  <label className="flex items-center gap-2 py-0.5 text-xs text-neutral-700" key={role.role_key}>
                                    <input
                                      checked={listEditDraft.visible_role_keys.includes(role.role_key)}
                                      onChange={(event) => toggleListEditRole(role.role_key, event.target.checked)}
                                      type="checkbox"
                                    />
                                    <span>{role.role_name} ({role.role_key})</span>
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </label>
                        <label className="text-xs font-medium text-neutral-700">
                          Department
                          <select
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, source_department: event.target.value } : prev))}
                            value={listEditDraft.source_department}
                          >
                            <option value="">Select department</option>
                            {DEPARTMENT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-neutral-700">
                          Starts At
                          <input
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, starts_at: event.target.value } : prev))}
                            type="datetime-local"
                            value={listEditDraft.starts_at}
                          />
                        </label>
                        <label className="text-xs font-medium text-neutral-700">
                          Ends At
                          <input
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, ends_at: event.target.value } : prev))}
                            type="datetime-local"
                            value={listEditDraft.ends_at}
                          />
                        </label>
                        <label className="text-xs font-medium text-neutral-700 md:col-span-3">
                          Details
                          <input
                            className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                            onChange={(event) => setListEditDraft((prev) => (prev ? { ...prev, details: event.target.value } : prev))}
                            value={listEditDraft.details}
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          className="min-h-[34px] border border-red-700 px-3 text-xs text-red-700 hover:bg-red-50"
                          disabled={saving}
                          onClick={() => void deleteListEntry()}
                          type="button"
                        >
                          Delete
                        </button>
                        <button
                          className="min-h-[34px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                          onClick={() => {
                            setExpandedListEventId(null);
                            setListEditDraft(null);
                          }}
                          type="button"
                        >
                          Close
                        </button>
                        <button
                          className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:opacity-60"
                          disabled={saving}
                          onClick={() => void saveListEntry()}
                          type="button"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </td></tr>
                ) : null}
                </Fragment>
              ))}
              {!upcomingEvents.length ? (
                <tr><td className="p-2 text-neutral-600" colSpan={6}>
                    No calendar entries yet.
                  </td></tr>
              ) : null}
            </tbody></table></div>
      )}

      {createModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">{modalMode === 'edit' ? 'Edit Calendar Entry' : 'Create Calendar Entry'}</h3>
            </header>
            <div className="grid gap-3 px-4 py-4 md:grid-cols-6">
              <label className="text-sm md:col-span-2">
                Title
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  value={draft.title}
                />
              </label>
              <label className="text-sm">
                Type
                <select
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, entry_type: event.target.value as CalendarEntryType }))}
                  value={draft.entry_type}
                >
                  {ENTRY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Visibility
                <div className="mt-1 space-y-2 border border-neutral-300 p-2">
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      checked={draft.view_for_everyone}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          view_for_everyone: event.target.checked,
                          visible_role_keys: event.target.checked ? [] : prev.visible_role_keys
                        }))
                      }
                      type="checkbox"
                    />
                    View for everyone
                  </label>
                  {!draft.view_for_everyone ? (
                    <div className="max-h-28 overflow-y-auto border border-neutral-200 bg-white p-1.5">
                      {availableRoles.map((role) => (
                        <label className="flex items-center gap-2 py-0.5 text-xs text-neutral-700" key={role.role_key}>
                          <input
                            checked={draft.visible_role_keys.includes(role.role_key)}
                            onChange={(event) => toggleDraftRole(role.role_key, event.target.checked)}
                            type="checkbox"
                          />
                          <span>{role.role_name} ({role.role_key})</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
              <label className="text-sm">
                Department
                <select
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, source_department: event.target.value }))}
                  value={draft.source_department}
                >
                  <option value="">Select department</option>
                  {DEPARTMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={createAsInventoryCheck}
                  onChange={(event) => setCreateAsInventoryCheck(event.target.checked)}
                  type="checkbox"
                />
                Create as Inventory Check
              </label>
              <label className="text-sm">
                Starts At
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, starts_at: event.target.value }))}
                  type="datetime-local"
                  value={draft.starts_at}
                />
              </label>
              <label className="text-sm">
                Ends At
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, ends_at: event.target.value }))}
                  type="datetime-local"
                  value={draft.ends_at}
                />
              </label>
              <label className="text-sm md:col-span-6">
                Details (goals / reminder notes)
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setDraft((prev) => ({ ...prev, details: event.target.value }))}
                  value={draft.details}
                />
              </label>
            </div>
            <footer className="flex justify-between gap-2 border-t border-neutral-300 px-4 py-3">
              <div>
                {modalMode === 'edit' ? (
                  <button
                    className="min-h-[36px] border border-red-700 px-3 text-sm text-red-700 hover:bg-red-50"
                    disabled={saving}
                    onClick={() => void deleteEntry()}
                    type="button"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
              <button
                className="min-h-[36px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setCreateModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  if (modalMode === 'create') {
                    setCreateModalOpen(false);
                    void saveEntry({ closeImmediately: true });
                    return;
                  }
                  void saveEntry();
                }}
                type="button"
              >
                {saving ? 'Saving...' : modalMode === 'edit' ? 'Save Changes' : 'Create'}
              </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
