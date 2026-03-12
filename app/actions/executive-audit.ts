'use server';

import { z } from 'zod';

import { ensureServerPermission } from '@/lib/server/permissions';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import { errorResult, generateCorrelationId, Result, successResult } from '@/lib/types';

const ExecutiveAuditFiltersSchema = z
  .object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    actor: z.string().optional(),
    action: z.string().optional(),
    tableName: z.string().optional(),
    department: z.string().optional(),
    source: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.dateFrom || !value.dateTo) return;
    const from = new Date(value.dateFrom);
    const to = new Date(value.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    const max = new Date(from);
    max.setFullYear(max.getFullYear() + 1);
    if (to > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'dateTo must be within 1 year of dateFrom'
      });
    }
  });

type ExecutiveAuditSource = 'hr_audit_log' | 'finance_report_activity_log';

export interface ExecutiveAuditFilters {
  dateFrom?: string;
  dateTo?: string;
  actor?: string;
  action?: string;
  tableName?: string;
  department?: string;
  source?: 'all' | ExecutiveAuditSource;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ExecutiveAuditEntry {
  id: string;
  source: ExecutiveAuditSource;
  timestamp: string;
  actor: string;
  department: string;
  action: string;
  tableName: string;
  recordId: string;
  details: Record<string, unknown>;
}

function parseCursor(
  cursor: string | undefined
): { timestamp: string; source: ExecutiveAuditSource; id: string } | null {
  if (!cursor) return null;
  const [timestamp, source, id] = cursor.split('|');
  if (!timestamp || !source || !id) return null;
  if (source !== 'hr_audit_log' && source !== 'finance_report_activity_log') return null;
  return { timestamp, source, id };
}

function inferDepartmentFromTable(tableName: string): string {
  const normalized = tableName.toLowerCase();
  if (
    normalized.startsWith('hr_') ||
    normalized === 'students' ||
    normalized === 'employee_settings' ||
    normalized === 'hr_attendance_overrides'
  ) {
    return 'HR';
  }
  if (normalized.startsWith('finance_')) return 'Finance';
  if (normalized.startsWith('marketing_')) return 'Marketing';
  if (normalized.startsWith('product_')) return 'Product';
  if (normalized.startsWith('inventory_')) return 'Inventory';
  if (normalized.startsWith('cfa_')) return 'Chick-fil-A';
  if (normalized.startsWith('employee_')) return 'Employee';
  if (normalized.startsWith('access_') || normalized.startsWith('executive_')) return 'Executive';
  return 'Executive';
}

function includesFilter(haystack: string, needle?: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

export async function getExecutiveAuditLog(
  filters: ExecutiveAuditFilters = {}
): Promise<Result<{ entries: ExecutiveAuditEntry[]; nextCursor: string | null }>> {
  const correlationId = generateCorrelationId();
  try {
    const canViewOverview = await ensureServerPermission('executive.overview.view');
    const canViewAccess = await ensureServerPermission('executive.access_control.view');
    if (!canViewOverview && !canViewAccess) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view executive audit logs.');
    }

    const parsed = ExecutiveAuditFiltersSchema.safeParse(filters);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.reduce<Record<string, string>>((acc, issue) => {
        acc[issue.path.join('.') || 'root'] = issue.message;
        return acc;
      }, {});
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Invalid audit filters', fieldErrors);
    }

    const supabase = createServerClient();
    const input = parsed.data;
    const limit = input.limit ?? 50;
    const sourceFilter = input.source ?? 'all';
    const cursor = parseCursor(input.cursor);

    const perSourceFetchLimit = Math.max(limit * 5, 300);

    let hrQuery = supabase
      .from('hr_audit_log')
      .select('id,user_id,action,table_name,record_id,old_value,new_value,timestamp')
      .order('timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(perSourceFetchLimit);
    let financeQuery = supabase
      .from('finance_report_activity_log')
      .select('id,report_id,action,actor,details,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(perSourceFetchLimit);

    if (input.dateFrom) {
      hrQuery = hrQuery.gte('timestamp', `${input.dateFrom}T00:00:00.000Z`);
      financeQuery = financeQuery.gte('created_at', `${input.dateFrom}T00:00:00.000Z`);
    }
    if (input.dateTo) {
      hrQuery = hrQuery.lte('timestamp', `${input.dateTo}T23:59:59.999Z`);
      financeQuery = financeQuery.lte('created_at', `${input.dateTo}T23:59:59.999Z`);
    }

    if (cursor) {
      if (cursor.source === 'hr_audit_log') {
        hrQuery = hrQuery.or(`timestamp.lt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.lt.${cursor.id})`);
        financeQuery = financeQuery.lte('created_at', cursor.timestamp);
      }
      if (cursor.source === 'finance_report_activity_log') {
        financeQuery = financeQuery.or(
          `created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${cursor.id})`
        );
        hrQuery = hrQuery.lte('timestamp', cursor.timestamp);
      }
    }

    const [hrResult, financeResult] = await Promise.all([
      sourceFilter === 'finance_report_activity_log' ? Promise.resolve({ data: [], error: null }) : hrQuery,
      sourceFilter === 'hr_audit_log' ? Promise.resolve({ data: [], error: null }) : financeQuery
    ]);

    if (hrResult.error) {
      return errorResult(correlationId, 'DB_ERROR', hrResult.error.message);
    }
    if (financeResult.error) {
      return errorResult(correlationId, 'DB_ERROR', financeResult.error.message);
    }

    const hrEntries: ExecutiveAuditEntry[] = (hrResult.data ?? []).map((row) => ({
      id: String(row.id ?? ''),
      source: 'hr_audit_log',
      timestamp: String(row.timestamp ?? ''),
      actor: String(row.user_id ?? 'open_access'),
      department: inferDepartmentFromTable(String(row.table_name ?? '')),
      action: String(row.action ?? ''),
      tableName: String(row.table_name ?? ''),
      recordId: String(row.record_id ?? ''),
      details: {
        old_value: (row.old_value ?? null) as Record<string, unknown> | null,
        new_value: (row.new_value ?? null) as Record<string, unknown> | null
      }
    }));

    const financeEntries: ExecutiveAuditEntry[] = (financeResult.data ?? []).map((row) => ({
      id: String(row.id ?? ''),
      source: 'finance_report_activity_log',
      timestamp: String(row.created_at ?? ''),
      actor: String(row.actor ?? 'open_access'),
      department: 'Finance',
      action: String(row.action ?? ''),
      tableName: 'finance_report_activity_log',
      recordId: String(row.report_id ?? ''),
      details: (row.details ?? {}) as Record<string, unknown>
    }));

    const merged = [...hrEntries, ...financeEntries]
      .filter((entry) => includesFilter(entry.actor, input.actor))
      .filter((entry) => includesFilter(entry.action, input.action))
      .filter((entry) => includesFilter(entry.tableName, input.tableName))
      .filter((entry) => {
        if (!input.department || input.department === 'all') return true;
        return entry.department.toLowerCase() === input.department.toLowerCase();
      })
      .filter((entry) => {
        if (!input.search?.trim()) return true;
        const content = [
          entry.actor,
          entry.action,
          entry.tableName,
          entry.recordId,
          entry.department,
          JSON.stringify(entry.details ?? {})
        ].join(' ');
        return includesFilter(content, input.search);
      })
      .sort((left, right) => {
        const t = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
        if (t !== 0) return t;
        if (left.source !== right.source) return left.source > right.source ? 1 : -1;
        return right.id.localeCompare(left.id);
      });

    const hasMore = merged.length > limit;
    const entries = hasMore ? merged.slice(0, limit) : merged;
    const last = entries.at(-1);
    const nextCursor = hasMore && last ? `${last.timestamp}|${last.source}|${last.id}` : null;

    logInfo('executive_audit_log_read', {
      correlationId,
      returned: entries.length,
      hasMore
    });

    return successResult({ entries, nextCursor }, correlationId);
  } catch (error) {
    logError('executive_audit_log_read_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load executive audit log entries.');
  }
}
