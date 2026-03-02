import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AssetType,
  CoordinationLogRow,
  CoordinationMethod,
  EventAssetRow,
  EventContactRow,
  EventNoteRow,
  ExternalContactRow,
  InternalCoordinatorRow,
  MarketingEventBundle,
  MarketingEventCategoryRow,
  MarketingEventFilters,
  MarketingEventRow,
  MarketingReportRow,
  MarketingEventStatus
} from '@/lib/marketing/types';

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function formatDateForSearch(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function mapEvent(row: Record<string, unknown>): MarketingEventRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    status: (row.status as MarketingEventStatus) ?? 'draft',
    category: (row.category as string | null) ?? null,
    starts_at: String(row.starts_at),
    ends_at: (row.ends_at as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    goals: (row.goals as string | null) ?? null,
    target_audience: (row.target_audience as string | null) ?? null,
    budget_planned: asNumber(row.budget_planned),
    budget_actual: asNumber(row.budget_actual),
    supplies_needed: (row.supplies_needed as string | null) ?? null,
    links: Array.isArray(row.links) ? (row.links as string[]) : [],
    cover_asset_id: (row.cover_asset_id as string | null) ?? null,
    outcome_summary: (row.outcome_summary as string | null) ?? null,
    what_worked: (row.what_worked as string | null) ?? null,
    what_didnt: (row.what_didnt as string | null) ?? null,
    recommendations: (row.recommendations as string | null) ?? null,
    estimated_interactions: asNumber(row.estimated_interactions),
    units_sold: asNumber(row.units_sold),
    revenue_impact: asNumber(row.revenue_impact),
    engagement_notes: (row.engagement_notes as string | null) ?? null,
    cost_roi_notes: (row.cost_roi_notes as string | null) ?? null,
    updated_at: String(row.updated_at ?? row.starts_at ?? new Date().toISOString())
  };
}

function mapContact(row: Record<string, unknown>): ExternalContactRow {
  return {
    id: String(row.id),
    organization: String(row.organization ?? ''),
    person_name: String(row.person_name ?? ''),
    role_title: (row.role_title as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    instagram_handle: (row.instagram_handle as string | null) ?? null,
    linkedin_url: (row.linkedin_url as string | null) ?? null,
    other_social: (row.other_social as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

function mapInternalCoordinator(row: Record<string, unknown>): InternalCoordinatorRow {
  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ''),
    role_title: (row.role_title as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    instagram_handle: (row.instagram_handle as string | null) ?? null,
    linkedin_url: (row.linkedin_url as string | null) ?? null,
    other_social: (row.other_social as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

function mapEventContact(row: Record<string, unknown>): EventContactRow {
  const joinedRaw = row.contact as Record<string, unknown> | Record<string, unknown>[] | null;
  const joined = Array.isArray(joinedRaw) ? (joinedRaw[0] ?? null) : joinedRaw;
  const joinedCoordinatorRaw = row.internal_coordinator as Record<string, unknown> | Record<string, unknown>[] | null;
  const joinedCoordinator = Array.isArray(joinedCoordinatorRaw) ? (joinedCoordinatorRaw[0] ?? null) : joinedCoordinatorRaw;
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    contact_id: (row.contact_id as string | null) ?? null,
    internal_coordinator_id: (row.internal_coordinator_id as string | null) ?? null,
    is_internal: Boolean(row.is_internal),
    coordinator_name: (row.coordinator_name as string | null) ?? null,
    coordinator_role: (row.coordinator_role as string | null) ?? null,
    coordinator_contact: (row.coordinator_contact as string | null) ?? null,
    coordinator_notes: (row.coordinator_notes as string | null) ?? null,
    contact: joined ? mapContact(joined) : null,
    internal_coordinator: joinedCoordinator ? mapInternalCoordinator(joinedCoordinator) : null
  };
}

function mapAsset(row: Record<string, unknown>): EventAssetRow {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    bucket: String(row.bucket ?? 'marketing-files'),
    storage_path: String(row.storage_path ?? ''),
    file_name: String(row.file_name ?? ''),
    mime_type: (row.mime_type as string | null) ?? null,
    size_bytes: asNumber(row.size_bytes),
    asset_type: ((row.asset_type as AssetType | null) ?? 'other') as AssetType,
    caption: (row.caption as string | null) ?? null,
    is_cover: Boolean(row.is_cover),
    created_at: String(row.created_at ?? new Date().toISOString())
  };
}

function mapNote(row: Record<string, unknown>): EventNoteRow {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    note: String(row.note ?? ''),
    author: (row.author as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString())
  };
}

function mapCoordination(row: Record<string, unknown>): CoordinationLogRow {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    contacted_party: String(row.contacted_party ?? ''),
    method: ((row.method as CoordinationMethod | null) ?? 'email') as CoordinationMethod,
    summary: String(row.summary ?? ''),
    next_steps: (row.next_steps as string | null) ?? null,
    next_steps_due_at: (row.next_steps_due_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString())
  };
}

function mapReport(row: Record<string, unknown>): MarketingReportRow {
  const linked = row.linked_event as
    | { id?: string | null; title?: string | null; starts_at?: string | null }
    | Array<{ id?: string | null; title?: string | null; starts_at?: string | null }>
    | null;
  const joined = Array.isArray(linked) ? (linked[0] ?? null) : linked;
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    category: (row.category as string | null) ?? null,
    report_date: String(row.report_date ?? new Date().toISOString().slice(0, 10)),
    notes: (row.notes as string | null) ?? null,
    perceived_impact: (row.perceived_impact as string | null) ?? null,
    optional_cost: asNumber(row.optional_cost),
    linked_event_id: (row.linked_event_id as string | null) ?? null,
    linked_event_title: joined?.title ?? null,
    linked_event_starts_at: joined?.starts_at ?? null,
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

function mapEventCategory(row: Record<string, unknown>): MarketingEventCategoryRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    active: Boolean(row.active ?? true),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

interface SaveEventInput {
  id?: string;
  title: string;
  status: MarketingEventStatus;
  category: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  description: string | null;
  goals: string | null;
  target_audience: string | null;
  budget_planned: number | null;
  budget_actual: number | null;
  supplies_needed: string | null;
  links: string[];
  outcome_summary: string | null;
  what_worked: string | null;
  what_didnt: string | null;
  recommendations: string | null;
  estimated_interactions: number | null;
  units_sold: number | null;
  revenue_impact: number | null;
  engagement_notes: string | null;
  cost_roi_notes: string | null;
  cover_asset_id: string | null;
}

interface SaveReportInput {
  id?: string;
  title: string;
  category: string | null;
  report_date: string;
  notes: string | null;
  perceived_impact: string | null;
  optional_cost: number | null;
  linked_event_id: string | null;
}

export interface MarketingRepository {
  listEvents(filters: MarketingEventFilters): Promise<MarketingEventRow[]>;
  listEventCategories(): Promise<MarketingEventCategoryRow[]>;
  createEventCategory(name: string): Promise<MarketingEventCategoryRow>;
  searchEvents(query: string): Promise<MarketingEventRow[]>;
  listContacts(query: string): Promise<ExternalContactRow[]>;
  listInternalCoordinators(query: string): Promise<InternalCoordinatorRow[]>;
  listEventIndicators(
    eventIds: string[]
  ): Promise<Record<string, { assets: number; internalContacts: number; externalContacts: number }>>;
  listEventSearchIndex(eventIds: string[]): Promise<Record<string, { external: string; internal: string }>>;
  listLinkedEventIdsForContact(contactId: string): Promise<string[]>;
  listLinkedEventIdsForInternalCoordinator(internalCoordinatorId: string): Promise<string[]>;
  getEventBundle(eventId: string): Promise<MarketingEventBundle>;
  saveEvent(input: SaveEventInput): Promise<MarketingEventRow>;
  deleteEvent(eventId: string): Promise<void>;
  saveContact(input: Partial<ExternalContactRow> & { organization: string; person_name: string }): Promise<ExternalContactRow>;
  addInternalCoordinator(input: {
    eventId: string;
    coordinatorName: string;
    coordinatorRole?: string | null;
    coordinatorContact?: string | null;
    coordinatorNotes?: string | null;
  }): Promise<EventContactRow>;
  linkExternalContact(input: { eventId: string; contactId: string }): Promise<EventContactRow>;
  linkInternalCoordinator(input: { eventId: string; internalCoordinatorId: string }): Promise<EventContactRow>;
  unlinkEventContact(eventContactId: string): Promise<void>;
  addEventNote(input: { eventId: string; note: string; author?: string | null }): Promise<EventNoteRow>;
  addCoordinationLog(input: {
    eventId: string;
    contactedParty: string;
    method: CoordinationMethod;
    summary: string;
    nextSteps?: string | null;
    nextStepsDueAt?: string | null;
    createdBy?: string | null;
  }): Promise<CoordinationLogRow>;
  uploadAsset(input: { eventId: string; file: File; assetType: AssetType; caption?: string | null }): Promise<EventAssetRow>;
  setCoverAsset(input: { eventId: string; assetId: string }): Promise<void>;
  saveInternalCoordinator(
    input: Partial<InternalCoordinatorRow> & {
      full_name: string;
    }
  ): Promise<InternalCoordinatorRow>;
  saveReport(input: SaveReportInput): Promise<MarketingReportRow>;
  deleteReport(reportId: string): Promise<void>;
  listReportRows(input: {
    query: string;
    dateFrom?: string;
    dateTo?: string;
    category?: string;
  }): Promise<MarketingReportRow[]>;
}

export function createMarketingRepository(supabase: SupabaseClient): MarketingRepository {
  return {
    async listEvents(filters) {
      let query = supabase
        .from('marketing_events')
        .select('*')
        .order('starts_at', { ascending: false });

      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.category !== 'all') {
        query = query.eq('category', filters.category);
      }

      if (filters.query.trim()) {
        const escaped = filters.query.trim().replaceAll(',', ' ');
        query = query.or(`title.ilike.%${escaped}%,location.ilike.%${escaped}%,description.ilike.%${escaped}%,category.ilike.%${escaped}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapEvent);
    },

    async listEventCategories() {
      const { data, error } = await supabase
        .from('marketing_event_categories')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapEventCategory);
    },

    async createEventCategory(name) {
      const normalized = name.trim();
      const { data, error } = await supabase
        .from('marketing_event_categories')
        .upsert(
          {
            name: normalized,
            active: true,
            updated_by: 'dashboard'
          },
          { onConflict: 'name' }
        )
        .select('*')
        .single();
      if (error) throw error;
      return mapEventCategory((data ?? {}) as Record<string, unknown>);
    },

    async searchEvents(query) {
      const { data, error } = await supabase.from('marketing_events').select('*').order('starts_at', { ascending: false }).limit(300);
      if (error) throw error;
      const allRows = ((data ?? []) as Record<string, unknown>[]).map(mapEvent);
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return allRows.slice(0, 50);
      return allRows
        .filter((row) =>
          [
            row.title,
            row.category ?? '',
            row.location ?? '',
            row.description ?? '',
            row.starts_at,
            formatDateForSearch(row.starts_at)
          ]
            .join(' ')
            .toLowerCase()
            .includes(trimmed)
        )
        .slice(0, 50);
    },

    async listContacts(query) {
      let request = supabase
        .from('external_contacts')
        .select('*')
        .order('organization', { ascending: true })
        .order('person_name', { ascending: true });

      if (query.trim()) {
        const escaped = query.trim().replaceAll(',', ' ');
        request = request.or(`organization.ilike.%${escaped}%,person_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
      }

      const { data, error } = await request;
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapContact);
    },

    async listInternalCoordinators(query) {
      let request = supabase
        .from('internal_coordinators')
        .select('*')
        .order('full_name', { ascending: true });

      if (query.trim()) {
        const escaped = query.trim().replaceAll(',', ' ');
        request = request.or(
          `full_name.ilike.%${escaped}%,role_title.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,notes.ilike.%${escaped}%`
        );
      }

      const { data, error } = await request;
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapInternalCoordinator);
    },

    async listEventIndicators(eventIds) {
      if (!eventIds.length) return {};

      const [assetResult, contactResult] = await Promise.all([
        supabase.from('event_assets').select('event_id').in('event_id', eventIds),
        supabase.from('event_contacts').select('event_id,is_internal').in('event_id', eventIds)
      ]);

      if (assetResult.error) throw assetResult.error;
      if (contactResult.error) throw contactResult.error;

      const output: Record<string, { assets: number; internalContacts: number; externalContacts: number }> = {};
      eventIds.forEach((id) => {
        output[id] = { assets: 0, internalContacts: 0, externalContacts: 0 };
      });

      ((assetResult.data ?? []) as Array<{ event_id: string }>).forEach((row) => {
        if (!output[row.event_id]) output[row.event_id] = { assets: 0, internalContacts: 0, externalContacts: 0 };
        output[row.event_id].assets += 1;
      });

      ((contactResult.data ?? []) as Array<{ event_id: string; is_internal: boolean }>).forEach((row) => {
        if (!output[row.event_id]) output[row.event_id] = { assets: 0, internalContacts: 0, externalContacts: 0 };
        if (row.is_internal) output[row.event_id].internalContacts += 1;
        else output[row.event_id].externalContacts += 1;
      });

      return output;
    },

    async listEventSearchIndex(eventIds) {
      if (!eventIds.length) return {};
      const { data, error } = await supabase
        .from('event_contacts')
        .select(
          'event_id,is_internal,coordinator_name,coordinator_role,coordinator_contact,contact:external_contacts(organization,person_name,role_title,email,phone),internal_coordinator:internal_coordinators(full_name,role_title,email,phone)'
        )
        .in('event_id', eventIds);
      if (error) throw error;

      const output: Record<string, { external: string; internal: string }> = {};
      eventIds.forEach((id) => {
        output[id] = { external: '', internal: '' };
      });

      (
        (data ?? []) as Array<{
          event_id: string;
          is_internal: boolean;
          coordinator_name: string | null;
          coordinator_role: string | null;
          coordinator_contact: string | null;
          internal_coordinator:
            | {
                full_name: string | null;
                role_title: string | null;
                email: string | null;
                phone: string | null;
              }
            | Array<{
                full_name: string | null;
                role_title: string | null;
                email: string | null;
                phone: string | null;
              }>
            | null;
          contact:
            | {
                organization: string | null;
                person_name: string | null;
                role_title: string | null;
                email: string | null;
                phone: string | null;
              }
            | Array<{
                organization: string | null;
                person_name: string | null;
                role_title: string | null;
                email: string | null;
                phone: string | null;
              }>
            | null;
        }>
      ).forEach((row) => {
        if (!output[row.event_id]) output[row.event_id] = { external: '', internal: '' };
        const joined = Array.isArray(row.contact) ? (row.contact[0] ?? null) : row.contact;
        const joinedCoordinator = Array.isArray(row.internal_coordinator)
          ? (row.internal_coordinator[0] ?? null)
          : row.internal_coordinator;
        if (row.is_internal) {
          output[row.event_id].internal = [
            output[row.event_id].internal,
            joinedCoordinator?.full_name ?? row.coordinator_name ?? '',
            joinedCoordinator?.role_title ?? row.coordinator_role ?? '',
            joinedCoordinator?.email ?? '',
            joinedCoordinator?.phone ?? '',
            row.coordinator_contact ?? ''
          ]
            .join(' ')
            .trim();
        } else {
          output[row.event_id].external = [
            output[row.event_id].external,
            joined?.organization ?? '',
            joined?.person_name ?? '',
            joined?.role_title ?? '',
            joined?.email ?? '',
            joined?.phone ?? ''
          ]
            .join(' ')
            .trim();
        }
      });

      return output;
    },

    async listLinkedEventIdsForContact(contactId) {
      const { data, error } = await supabase.from('event_contacts').select('event_id').eq('contact_id', contactId);
      if (error) throw error;
      return ((data ?? []) as Array<{ event_id: string }>).map((row) => row.event_id);
    },

    async listLinkedEventIdsForInternalCoordinator(internalCoordinatorId) {
      const { data, error } = await supabase
        .from('event_contacts')
        .select('event_id')
        .eq('internal_coordinator_id', internalCoordinatorId);
      if (error) throw error;
      return ((data ?? []) as Array<{ event_id: string }>).map((row) => row.event_id);
    },

    async getEventBundle(eventId) {
      const [eventResult, eventContactsResult, assetsResult, notesResult, coordinationResult] = await Promise.all([
        supabase.from('marketing_events').select('*').eq('id', eventId).single(),
        supabase
          .from('event_contacts')
          .select(
            'id,event_id,contact_id,internal_coordinator_id,is_internal,coordinator_name,coordinator_role,coordinator_contact,coordinator_notes,contact:external_contacts(id,organization,person_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at),internal_coordinator:internal_coordinators(id,full_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at)'
          )
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase.from('event_assets').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
        supabase.from('event_notes').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
        supabase.from('coordination_logs').select('*').eq('event_id', eventId).order('created_at', { ascending: false })
      ]);

      if (eventResult.error) throw eventResult.error;
      if (eventContactsResult.error) throw eventContactsResult.error;
      if (assetsResult.error) throw assetsResult.error;
      if (notesResult.error) throw notesResult.error;
      if (coordinationResult.error) throw coordinationResult.error;

      return {
        event: mapEvent((eventResult.data ?? {}) as Record<string, unknown>),
        eventContacts: ((eventContactsResult.data ?? []) as Record<string, unknown>[]).map(mapEventContact),
        assets: ((assetsResult.data ?? []) as Record<string, unknown>[]).map(mapAsset),
        notes: ((notesResult.data ?? []) as Record<string, unknown>[]).map(mapNote),
        coordinationLogs: ((coordinationResult.data ?? []) as Record<string, unknown>[]).map(mapCoordination)
      };
    },

    async saveEvent(input) {
      const payload = {
        id: input.id,
        title: input.title,
        status: input.status,
        category: input.category,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        location: input.location,
        description: input.description,
        goals: input.goals,
        target_audience: input.target_audience,
        budget_planned: input.budget_planned,
        budget_actual: input.budget_actual,
        supplies_needed: input.supplies_needed,
        links: input.links,
        outcome_summary: input.outcome_summary,
        what_worked: input.what_worked,
        what_didnt: input.what_didnt,
        recommendations: input.recommendations,
        estimated_interactions: input.estimated_interactions,
        units_sold: input.units_sold,
        revenue_impact: input.revenue_impact,
        engagement_notes: input.engagement_notes,
        cost_roi_notes: input.cost_roi_notes,
        cover_asset_id: input.cover_asset_id,
        updated_by: 'dashboard'
      };

      const { data, error } = await supabase.from('marketing_events').upsert(payload).select('*').single();
      if (error) throw error;
      return mapEvent((data ?? {}) as Record<string, unknown>);
    },

    async deleteEvent(eventId) {
      const { error } = await supabase.from('marketing_events').delete().eq('id', eventId);
      if (error) throw error;
    },

    async saveContact(input) {
      const payload = {
        id: input.id,
        organization: input.organization,
        person_name: input.person_name,
        role_title: input.role_title ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        instagram_handle: input.instagram_handle ?? null,
        linkedin_url: input.linkedin_url ?? null,
        other_social: input.other_social ?? null,
        notes: input.notes ?? null,
        updated_by: 'dashboard'
      };

      const { data, error } = await supabase.from('external_contacts').upsert(payload).select('*').single();
      if (error) throw error;
      return mapContact((data ?? {}) as Record<string, unknown>);
    },

    async addInternalCoordinator(input) {
      const { data, error } = await supabase
        .from('event_contacts')
        .insert({
          event_id: input.eventId,
          is_internal: true,
          coordinator_name: input.coordinatorName,
          coordinator_role: input.coordinatorRole ?? null,
          coordinator_contact: input.coordinatorContact ?? null,
          coordinator_notes: input.coordinatorNotes ?? null
        })
        .select('id,event_id,contact_id,is_internal,coordinator_name,coordinator_role,coordinator_contact,coordinator_notes')
        .single();
      if (error) throw error;
      return mapEventContact((data ?? {}) as Record<string, unknown>);
    },

    async linkExternalContact(input) {
      const { data, error } = await supabase
        .from('event_contacts')
        .upsert({
          event_id: input.eventId,
          contact_id: input.contactId,
          is_internal: false
        }, { onConflict: 'event_id,contact_id' })
        .select(
          'id,event_id,contact_id,internal_coordinator_id,is_internal,coordinator_name,coordinator_role,coordinator_contact,coordinator_notes,contact:external_contacts(id,organization,person_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at),internal_coordinator:internal_coordinators(id,full_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at)'
        )
        .single();
      if (error) throw error;
      return mapEventContact((data ?? {}) as Record<string, unknown>);
    },

    async linkInternalCoordinator(input) {
      const { data, error } = await supabase
        .from('event_contacts')
        .upsert({
          event_id: input.eventId,
          internal_coordinator_id: input.internalCoordinatorId,
          is_internal: true,
          contact_id: null,
          coordinator_name: null,
          coordinator_role: null,
          coordinator_contact: null,
          coordinator_notes: null
        }, { onConflict: 'event_id,internal_coordinator_id' })
        .select(
          'id,event_id,contact_id,internal_coordinator_id,is_internal,coordinator_name,coordinator_role,coordinator_contact,coordinator_notes,contact:external_contacts(id,organization,person_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at),internal_coordinator:internal_coordinators(id,full_name,role_title,email,phone,instagram_handle,linkedin_url,other_social,notes,updated_at)'
        )
        .single();
      if (error) throw error;
      return mapEventContact((data ?? {}) as Record<string, unknown>);
    },

    async unlinkEventContact(eventContactId) {
      const { error } = await supabase.from('event_contacts').delete().eq('id', eventContactId);
      if (error) throw error;
    },

    async addEventNote(input) {
      const { data, error } = await supabase
        .from('event_notes')
        .insert({
          event_id: input.eventId,
          note: input.note,
          author: input.author ?? null
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapNote((data ?? {}) as Record<string, unknown>);
    },

    async addCoordinationLog(input) {
      const { data, error } = await supabase
        .from('coordination_logs')
        .insert({
          event_id: input.eventId,
          contacted_party: input.contactedParty,
          method: input.method,
          summary: input.summary,
          next_steps: input.nextSteps ?? null,
          next_steps_due_at: input.nextStepsDueAt ?? null,
          created_by: input.createdBy ?? null
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapCoordination((data ?? {}) as Record<string, unknown>);
    },

    async uploadAsset(input) {
      const bucket = 'marketing-files';
      const storagePath = `${input.eventId}/${Date.now()}-${sanitizePathSegment(input.file.name)}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, input.file, {
        upsert: false,
        contentType: input.file.type || undefined
      });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from('event_assets')
        .insert({
          event_id: input.eventId,
          bucket,
          storage_path: storagePath,
          file_name: input.file.name,
          mime_type: input.file.type || null,
          size_bytes: input.file.size,
          asset_type: input.assetType,
          caption: input.caption ?? null,
          uploaded_by: 'dashboard'
        })
        .select('*')
        .single();
      if (error) throw error;

      return mapAsset((data ?? {}) as Record<string, unknown>);
    },

    async setCoverAsset(input) {
      const { error: unsetError } = await supabase.from('event_assets').update({ is_cover: false }).eq('event_id', input.eventId);
      if (unsetError) throw unsetError;

      const { error: setError } = await supabase.from('event_assets').update({ is_cover: true }).eq('id', input.assetId);
      if (setError) throw setError;

      const { error: eventError } = await supabase
        .from('marketing_events')
        .update({ cover_asset_id: input.assetId, updated_by: 'dashboard' })
        .eq('id', input.eventId);
      if (eventError) throw eventError;
    },

    async saveInternalCoordinator(input) {
      const payload = {
        id: input.id,
        full_name: input.full_name,
        role_title: input.role_title ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        instagram_handle: input.instagram_handle ?? null,
        linkedin_url: input.linkedin_url ?? null,
        other_social: input.other_social ?? null,
        notes: input.notes ?? null,
        updated_by: 'dashboard'
      };

      const { data, error } = await supabase.from('internal_coordinators').upsert(payload).select('*').single();
      if (error) throw error;
      return mapInternalCoordinator((data ?? {}) as Record<string, unknown>);
    },

    async saveReport(input) {
      const payload = {
        id: input.id,
        title: input.title,
        category: input.category,
        report_date: input.report_date,
        notes: input.notes,
        perceived_impact: input.perceived_impact,
        optional_cost: input.optional_cost,
        linked_event_id: input.linked_event_id,
        updated_by: 'dashboard'
      };

      const { data, error } = await supabase
        .from('marketing_reports')
        .upsert(payload)
        .select('id,title,category,report_date,notes,perceived_impact,optional_cost,linked_event_id,updated_at,linked_event:marketing_events(id,title,starts_at)')
        .single();
      if (error) throw error;
      return mapReport((data ?? {}) as Record<string, unknown>);
    },

    async deleteReport(reportId) {
      const { error } = await supabase.from('marketing_reports').delete().eq('id', reportId);
      if (error) throw error;
    },

    async listReportRows(input) {
      let request = supabase
        .from('marketing_reports')
        .select('id,title,category,report_date,notes,perceived_impact,optional_cost,linked_event_id,updated_at,linked_event:marketing_events(id,title,starts_at)')
        .order('report_date', { ascending: false });

      if (input.category && input.category !== 'all') {
        request = request.eq('category', input.category);
      }

      if (input.dateFrom) {
        request = request.gte('report_date', input.dateFrom);
      }

      if (input.dateTo) {
        request = request.lte('report_date', input.dateTo);
      }

      if (input.query.trim()) {
        const escaped = input.query.trim().replaceAll(',', ' ');
        request = request.or(`title.ilike.%${escaped}%,category.ilike.%${escaped}%,notes.ilike.%${escaped}%,perceived_impact.ilike.%${escaped}%`);
      }

      const { data, error } = await request;
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapReport);
    }
  };
}
