export type MarketingEventStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';

export type CoordinationMethod = 'email' | 'call' | 'in_person' | 'text' | 'other';

export type AssetType = 'flyer' | 'photo' | 'mockup' | 'schedule' | 'other';

export interface MarketingEventRow {
  id: string;
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
  cover_asset_id: string | null;
  outcome_summary: string | null;
  what_worked: string | null;
  what_didnt: string | null;
  recommendations: string | null;
  estimated_interactions: number | null;
  units_sold: number | null;
  revenue_impact: number | null;
  engagement_notes: string | null;
  cost_roi_notes: string | null;
  updated_at: string;
}

export interface ExternalContactRow {
  id: string;
  organization: string;
  person_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
  linkedin_url: string | null;
  other_social: string | null;
  notes: string | null;
  updated_at: string;
}

export interface InternalCoordinatorRow {
  id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
  linkedin_url: string | null;
  other_social: string | null;
  notes: string | null;
  updated_at: string;
}

export interface EventContactRow {
  id: string;
  event_id: string;
  contact_id: string | null;
  internal_coordinator_id: string | null;
  is_internal: boolean;
  coordinator_name: string | null;
  coordinator_role: string | null;
  coordinator_contact: string | null;
  coordinator_notes: string | null;
  contact: ExternalContactRow | null;
  internal_coordinator: InternalCoordinatorRow | null;
}

export interface EventAssetRow {
  id: string;
  event_id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  asset_type: AssetType;
  caption: string | null;
  is_cover: boolean;
  created_at: string;
}

export interface EventNoteRow {
  id: string;
  event_id: string;
  note: string;
  author: string | null;
  created_at: string;
}

export interface CoordinationLogRow {
  id: string;
  event_id: string;
  contacted_party: string;
  method: CoordinationMethod;
  summary: string;
  next_steps: string | null;
  next_steps_due_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MarketingEventBundle {
  event: MarketingEventRow;
  eventContacts: EventContactRow[];
  assets: EventAssetRow[];
  notes: EventNoteRow[];
  coordinationLogs: CoordinationLogRow[];
}

export interface MarketingEventFilters {
  query: string;
  status: 'all' | MarketingEventStatus;
  category: string | 'all';
}

export interface MarketingEventCategoryRow {
  id: string;
  name: string;
  active: boolean;
  updated_at: string;
}

export interface MarketingReportRow {
  id: string;
  title: string;
  category: string | null;
  report_date: string;
  notes: string | null;
  perceived_impact: string | null;
  optional_cost: number | null;
  linked_event_id: string | null;
  linked_event_title: string | null;
  linked_event_starts_at: string | null;
  updated_at: string;
}
