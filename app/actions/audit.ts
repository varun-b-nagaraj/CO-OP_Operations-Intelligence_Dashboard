'use server';

import { z } from 'zod';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import { AuditEntry, errorResult, generateCorrelationId, Result, successResult } from '@/lib/types';

const AuditFiltersSchema = z
  .object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    userId: z.string().optional(),
    actionType: z.string().optional(),
    tableName: z.string().optional(),
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

export interface AuditFilters {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  actionType?: string;
  tableName?: string;
  limit?: number;
  cursor?: string;
}

export async function createAuditEntry(
  action: string,
  tableName: string,
  recordId: string,
  oldValue: unknown,
  newValue: unknown
): Promise<void> {
  const correlationId = generateCorrelationId();
  const supabase = createServerClient();
  await insertAuditEntry(
    supabase,
    {
      action,
      tableName,
      recordId,
      oldValue,
      newValue,
      userId: 'open_access'
    },
    correlationId
  );
}

export async function getAuditLog(
  filters: AuditFilters = {}
): Promise<Result<{ entries: AuditEntry[]; nextCursor: string | null }>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.audit.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view audit logs.');
    }

    const parsed = AuditFiltersSchema.safeParse(filters);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.reduce<Record<string, string>>((acc, issue) => {
        acc[issue.path.join('.') || 'root'] = issue.message;
        return acc;
      }, {});
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Invalid audit filters', fieldErrors);
    }

    const supabase = createServerClient();
    const limit = parsed.data.limit ?? 50;
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (parsed.data.dateFrom) query = query.gte('timestamp', `${parsed.data.dateFrom}T00:00:00.000Z`);
    if (parsed.data.dateTo) query = query.lte('timestamp', `${parsed.data.dateTo}T23:59:59.999Z`);
    if (parsed.data.userId) query = query.eq('user_id', parsed.data.userId);
    if (parsed.data.actionType) query = query.ilike('action', `%${parsed.data.actionType}%`);
    if (parsed.data.tableName) query = query.eq('table_name', parsed.data.tableName);

    if (parsed.data.cursor) {
      const [timestamp, id] = parsed.data.cursor.split('|');
      if (timestamp && id) {
        query = query.or(`timestamp.lt.${timestamp},and(timestamp.eq.${timestamp},id.lt.${id})`);
      }
    }

    const { data, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const rows = (data ?? []) as AuditEntry[];
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${entries[entries.length - 1].timestamp}|${entries[entries.length - 1].id}`
      : null;

    logInfo('audit_log_read', {
      correlationId,
      returned: entries.length,
      hasMore
    });

    return successResult({ entries, nextCursor }, correlationId);
  } catch (error) {
    logError('audit_log_read_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load audit log entries.');
  }
}
