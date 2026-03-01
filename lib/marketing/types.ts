export type MarketingEventStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';

export type CoordinationMethod = 'email' | 'call' | 'in_person' | 'text';

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
  links: string[];
  cover_asset_id: string | null;
  outcome_summary: string | null;
  what_worked: string | null;
  what_didnt: string | null;
  recommendations: string | null;
  estimated_interactions: number | null;
  units_sold: number | null;
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
  notes: string | null;
  updated_at: string;
}

export interface EventContactRow {
  id: string;
  event_id: string;
  contact_id: string | null;
  is_internal: boolean;
  coordinator_name: string | null;
  coordinator_role: string | null;
  coordinator_notes: string | null;
  contact: ExternalContactRow | null;
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
  recentOnly: boolean;
  query: string;
  status: 'all' | MarketingEventStatus;
  category: string | 'all';
}
