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

  const startOfUtcDay = (value: Date): Date =>
    new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
  const endOfUtcDay = (value: Date): Date =>
    new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
  const parseDateToken = (value: string): Date | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(`${trimmed}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [monthText, dayText, yearText] = trimmed.split('/');
      const month = Number(monthText);
      const day = Number(dayText);
      const year = Number(yearText);
      if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };
  const parseQuantifier = (value: string): number | null => {
    const normalizedValue = value.trim().toLowerCase();
    if (/^\d{1,3}$/.test(normalizedValue)) {
      const parsed = Number(normalizedValue);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const words: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12
    };
    return words[normalizedValue] ?? null;
  };

  const fromToMatch = normalized.match(
    /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/
  );
  if (fromToMatch) {
    const from = parseDateToken(fromToMatch[1]);
    const to = parseDateToken(fromToMatch[2]);
    if (from && to) {
      return {
        mode: 'explicit',
        from: startOfUtcDay(from).toISOString(),
        to: endOfUtcDay(to).toISOString()
      };
    }
  }

  const isoMatches = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (isoMatches.length >= 2) {
    const fromIso = isoMatches.at(0);
    const toIso = isoMatches.at(1);
    if (!fromIso || !toIso) return null;
    return {
      mode: 'explicit',
      from: `${fromIso}T00:00:00.000Z`,
      to: `${toIso}T23:59:59.999Z`
    };
  }

  const relativeMatch = normalized.match(
    /\b(?:over\s+)?(?:the\s+)?(?:last|past|previous)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|days|week|weeks|month|months)\b/
  );
  if (relativeMatch) {
    const quantity = parseQuantifier(relativeMatch[1]);
    const unit = relativeMatch[2];
    if (quantity) {
      const to = endOfUtcDay(new Date());
      const from = new Date(to);
      if (unit === 'day' || unit === 'days') from.setUTCDate(from.getUTCDate() - quantity);
      if (unit === 'week' || unit === 'weeks') from.setUTCDate(from.getUTCDate() - quantity * 7);
      if (unit === 'month' || unit === 'months') from.setUTCMonth(from.getUTCMonth() - quantity);
      return {
        mode: 'explicit',
        from: startOfUtcDay(from).toISOString(),
        to: to.toISOString()
      };
    }
  }

  const today = new Date();
  if (/\bthis\s+year\b/.test(normalized)) {
    const year = today.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(today).toISOString()
    };
  }

  if (/\blast\s+year\b/.test(normalized)) {
    const year = today.getUTCFullYear() - 1;
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(end).toISOString()
    };
  }

  const sinceYearMatch = normalized.match(/\bsince\s+(20\d{2})\b/);
  if (sinceYearMatch) {
    const year = Number(sinceYearMatch[1]);
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
      const start = new Date(Date.UTC(year, 0, 1));
      return {
        mode: 'explicit',
        from: startOfUtcDay(start).toISOString(),
        to: endOfUtcDay(today).toISOString()
      };
    }
  }

  const inYearMatch = normalized.match(/\b(?:in|for)\s+(20\d{2})\b/);
  if (inYearMatch) {
    const year = Number(inYearMatch[1]);
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
      const start = new Date(Date.UTC(year, 0, 1));
      const isCurrentYear = year === today.getUTCFullYear();
      const end = isCurrentYear ? today : new Date(Date.UTC(year, 11, 31));
      return {
        mode: 'explicit',
        from: startOfUtcDay(start).toISOString(),
        to: endOfUtcDay(end).toISOString()
      };
    }
  }

  if (/\btoday\b/.test(normalized)) {
    return {
      mode: 'explicit',
      from: startOfUtcDay(today).toISOString(),
      to: endOfUtcDay(today).toISOString()
    };
  }

  if (/\byesterday\b/.test(normalized)) {
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() - 1);
    return {
      mode: 'explicit',
      from: startOfUtcDay(target).toISOString(),
      to: endOfUtcDay(target).toISOString()
    };
  }

  if (/\bthis\s+week\b/.test(normalized)) {
    const start = new Date(today);
    const day = start.getUTCDay();
    const distanceFromMonday = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - distanceFromMonday);
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(today).toISOString()
    };
  }

  if (/\blast\s+week\b/.test(normalized)) {
    const end = new Date(today);
    const day = end.getUTCDay();
    const distanceFromMonday = (day + 6) % 7;
    end.setUTCDate(end.getUTCDate() - distanceFromMonday - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(end).toISOString()
    };
  }

  if (/\bthis\s+month\b/.test(normalized)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(today).toISOString()
    };
  }

  if (/\blast\s+month\b/.test(normalized)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return {
      mode: 'explicit',
      from: startOfUtcDay(start).toISOString(),
      to: endOfUtcDay(end).toISOString()
    };
  }

  const slashMatches = normalized.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? [];
  if (slashMatches.length >= 2) {
    const fromSlash = slashMatches.at(0);
    const toSlash = slashMatches.at(1);
    if (!fromSlash || !toSlash) return null;
    const from = parseDateToken(fromSlash);
    const to = parseDateToken(toSlash);
    if (from && to) {
      return {
        mode: 'explicit',
        from: startOfUtcDay(from).toISOString(),
        to: endOfUtcDay(to).toISOString()
      };
    }
  }

  const singleIsoMatch = isoMatches[0];
  if (singleIsoMatch) {
    const parsed = parseDateToken(singleIsoMatch);
    if (parsed) {
      return {
        mode: 'explicit',
        from: startOfUtcDay(parsed).toISOString(),
        to: endOfUtcDay(parsed).toISOString()
      };
    }
  }

  const singleSlashMatch = slashMatches[0];
  if (singleSlashMatch) {
    const parsed = parseDateToken(singleSlashMatch);
    if (parsed) {
      return {
        mode: 'explicit',
        from: startOfUtcDay(parsed).toISOString(),
        to: endOfUtcDay(parsed).toISOString()
      };
    }
  }

  const rollingDaysMatch = normalized.match(/\blast\s+(\d{1,3})\s+days\b/);
  if (rollingDaysMatch) {
    const days = Number(rollingDaysMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      const to = endOfUtcDay(new Date());
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - days);
      return {
        mode: 'explicit',
        from: startOfUtcDay(from).toISOString(),
        to: to.toISOString()
      };
    }
  }

  return null;
}
