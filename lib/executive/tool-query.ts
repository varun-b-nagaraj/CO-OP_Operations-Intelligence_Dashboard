export type ToolQueryFilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'ilike'
  | 'contains'
  | 'is';

export type ToolDateRangeMode = 'auto' | 'explicit';

export interface ToolQueryFilter {
  column: string;
  op: ToolQueryFilterOperator;
  value: unknown;
}

export interface ToolDateRange {
  mode: ToolDateRangeMode;
  from?: string;
  to?: string;
  column?: string;
}

export interface ToolSort {
  column: string;
  direction?: 'asc' | 'desc';
}

export interface ToolQueryRequest {
  table: string;
  select?: string;
  filters?: ToolQueryFilter[];
  date_range?: ToolDateRange;
  sort?: ToolSort[];
  limit?: number;
  cursor?: string;
  include_related?: string[];
  include_storage_metadata?: boolean;
}

export interface ToolQueryResponse<T = Record<string, unknown>> {
  table: string;
  row_count: number;
  rows: T[];
  next_cursor: string | null;
  has_more: boolean;
  applied_sort: Array<{ column: string; direction: 'asc' | 'desc' }>;
  effective_window: { column: string; from?: string; to?: string } | null;
  offset: number;
  limit: number;
}

export interface ToolRelatedQueryRequest {
  table: string;
  parent_ids: string[];
  include_children?: boolean;
  limit_per_relation?: number;
}

export interface ToolStorageMetadataRequest {
  bucket: 'product-files' | 'marketing-files' | 'finance-files';
  limit?: number;
  cursor?: string;
  prefix?: string;
}

export interface ToolCatalogEntry {
  id: string;
  label: string;
  kind: 'department_pack' | 'table_tool' | 'discovery_tool';
  department: string;
  capabilityTags: string[];
  table?: string;
}

export interface QueryPlan {
  intentClass: 'tool_listing' | 'attendance_detail' | 'overview' | 'general';
  selectedTools: string[];
  dateRange: ToolDateRange;
  filters: ToolQueryFilter[];
  sort: ToolSort[];
  limit: number;
  targetEntities: string[];
}

export interface ToolExecutionRecord {
  toolId: string;
  table?: string;
  args: {
    dateRange?: ToolDateRange;
    filters?: ToolQueryFilter[];
    sort?: ToolSort[];
    limit?: number;
  };
  rowCount: number;
  rowHash: string;
  effectiveWindow: { column: string; from?: string; to?: string } | null;
  rows: Record<string, unknown>[];
}

export interface ValidationResult {
  passed: boolean;
  mismatches: string[];
  retryReason?: string;
}

export interface AnswerProvenance {
  sourceTables: string[];
  window: Array<{ table: string; column?: string; from?: string; to?: string }>;
  filters: Array<{ table: string; filters: ToolQueryFilter[] }>;
  rowCounts: Record<string, number>;
  toolIds: string[];
  validationStatus: 'passed' | 'failed' | 'not_applicable';
}

export function inferDefaultWindowForDepartment(department: string): ToolDateRange {
  const normalized = department.toLowerCase();
  if (normalized === 'hr') return { mode: 'auto' };
  if (normalized === 'calendar') return { mode: 'auto' };
  if (normalized === 'finance') return { mode: 'auto' };
  return { mode: 'auto' };
}

export function parsePromptExplicitDateRange(prompt: string): ToolDateRange | null {
  const normalized = prompt.toLowerCase();

  const isoMatches = prompt.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (isoMatches.length >= 2) {
    return {
      mode: 'explicit',
      from: `${isoMatches[0]}T00:00:00.000Z`,
      to: `${isoMatches[1]}T23:59:59.999Z`
    };
  }

  const lastDaysMatch = normalized.match(/\blast\s+(\d{1,3})\s+days\b/);
  if (lastDaysMatch) {
    const days = Number(lastDaysMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - days);
      return {
        mode: 'explicit',
        from: from.toISOString(),
        to: to.toISOString()
      };
    }
  }

  return null;
}
