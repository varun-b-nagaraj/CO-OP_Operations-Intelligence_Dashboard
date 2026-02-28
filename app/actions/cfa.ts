'use server';

import { SupabaseClient } from '@supabase/supabase-js';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  CFADailyLog,
  CFADailyLogLine,
  CFADayType,
  CFAItem,
  errorResult,
  generateCorrelationId,
  Result,
  successResult
} from '@/lib/types';
import {
  CFADailyLogUpsertSchema,
  CFAItemCreateSchema,
  CFAItemIdSchema,
  CFAItemUpdateSchema,
  DateStringSchema,
  zodFieldErrors
} from '@/lib/validation';

export interface CFADailyLogWithLines extends CFADailyLog {
  lines: CFADailyLogLine[];
}

export interface CFAHistoryFilters {
  from?: string;
  to?: string;
  dayType?: CFADayType | 'all';
}

function logId(input: Pick<CFADailyLog, 'log_date' | 'day_type'>): string {
  return `${input.log_date}-${input.day_type}`;
}

async function getLogWithLines(
  supabase: SupabaseClient,
  id: string
): Promise<CFADailyLogWithLines | null> {
  const { data: log, error: logErrorResult } = await supabase
    .from('cfa_daily_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (logErrorResult || !log) {
    return null;
  }

  const { data: lines, error: linesError } = await supabase
    .from('cfa_daily_log_lines')
    .select('*')
    .eq('log_id', id)
    .order('item_id', { ascending: true });

  if (linesError) {
    return null;
  }

  return {
    ...(log as CFADailyLog),
    lines: (lines ?? []) as CFADailyLogLine[]
  };
}

function normalizeFilterDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const parsed = DateStringSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export async function getCFAItems(includeInactive = true): Promise<Result<CFAItem[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.logs.read');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view CFA data.');
    }

    const supabase = createServerClient();
    let query = supabase.from('cfa_items').select('*').order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    return successResult((data ?? []) as CFAItem[], correlationId);
  } catch (error) {
    logError('get_cfa_items_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load CFA menu items.');
  }
}

export async function createCFAItem(input: {
  item_id: string;
  name: string;
  buy_cost_cents: number;
  sell_price_cents: number;
  active?: boolean;
}): Promise<Result<CFAItem>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.menu.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to manage CFA menu.');
    }

    const parsed = CFAItemCreateSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid CFA item payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const { data: created, error } = await supabase
      .from('cfa_items')
      .insert({
        ...parsed.data,
        updated_by: 'open_access'
      })
      .select('*')
      .single();

    if (error || !created) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to create CFA item');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'cfa_item_created',
        tableName: 'cfa_items',
        recordId: created.item_id,
        oldValue: null,
        newValue: created,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('cfa_item_created', {
      correlationId,
      itemId: created.item_id
    });

    return successResult(created as CFAItem, correlationId);
  } catch (error) {
    logError('create_cfa_item_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to create CFA item.');
  }
}

export async function updateCFAItem(
  itemId: string,
  input: {
    name: string;
    buy_cost_cents: number;
    sell_price_cents: number;
    active: boolean;
  }
): Promise<Result<CFAItem>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.menu.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to manage CFA menu.');
    }

    const parsedId = CFAItemIdSchema.safeParse(itemId);
    if (!parsedId.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid item id',
        zodFieldErrors(parsedId.error)
      );
    }

    const parsed = CFAItemUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid CFA item payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();

    const { data: existing, error: existingError } = await supabase
      .from('cfa_items')
      .select('*')
      .eq('item_id', parsedId.data)
      .maybeSingle();

    if (existingError || !existing) {
      return errorResult(correlationId, 'NOT_FOUND', 'CFA item not found.');
    }

    const { data: updated, error } = await supabase
      .from('cfa_items')
      .update({
        ...parsed.data,
        updated_by: 'open_access'
      })
      .eq('item_id', parsedId.data)
      .select('*')
      .single();

    if (error || !updated) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to update CFA item');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'cfa_item_updated',
        tableName: 'cfa_items',
        recordId: updated.item_id,
        oldValue: existing,
        newValue: updated,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('cfa_item_updated', {
      correlationId,
      itemId: updated.item_id
    });

    return successResult(updated as CFAItem, correlationId);
  } catch (error) {
    logError('update_cfa_item_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to update CFA item.');
  }
}

export async function getCFADailyLog(
  logDate: string,
  dayType: CFADayType
): Promise<Result<CFADailyLogWithLines | null>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.logs.read');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view CFA data.');
    }

    const parsedDate = DateStringSchema.safeParse(logDate);
    if (!parsedDate.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid log date',
        zodFieldErrors(parsedDate.error)
      );
    }

    const supabase = createServerClient();
    const { data: log, error } = await supabase
      .from('cfa_daily_logs')
      .select('*')
      .eq('log_date', parsedDate.data)
      .eq('day_type', dayType)
      .maybeSingle();

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    if (!log) {
      return successResult(null, correlationId);
    }

    const joined = await getLogWithLines(supabase, String(log.id));
    return successResult(joined, correlationId);
  } catch (error) {
    logError('get_cfa_daily_log_failed', {
      correlationId,
      logDate,
      dayType,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load CFA daily log.');
  }
}

export async function getCFAHistory(filters: CFAHistoryFilters): Promise<Result<CFADailyLogWithLines[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.logs.read');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view CFA data.');
    }

    const from = normalizeFilterDate(filters.from);
    const to = normalizeFilterDate(filters.to);

    const supabase = createServerClient();
    let query = supabase.from('cfa_daily_logs').select('*').order('log_date', { ascending: false });

    if (from) query = query.gte('log_date', from);
    if (to) query = query.lte('log_date', to);
    if (filters.dayType && filters.dayType !== 'all') query = query.eq('day_type', filters.dayType);

    const { data: logs, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const logRows = (logs ?? []) as CFADailyLog[];
    if (logRows.length === 0) {
      return successResult([], correlationId);
    }

    const ids = logRows.map((row) => row.id);
    const { data: lines, error: linesError } = await supabase
      .from('cfa_daily_log_lines')
      .select('*')
      .in('log_id', ids)
      .order('item_id', { ascending: true });

    if (linesError) {
      return errorResult(correlationId, 'DB_ERROR', linesError.message);
    }

    const linesByLogId = (lines ?? []).reduce<Record<string, CFADailyLogLine[]>>((acc, row) => {
      const key = String((row as CFADailyLogLine).log_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(row as CFADailyLogLine);
      return acc;
    }, {});

    const result: CFADailyLogWithLines[] = logRows.map((log) => ({
      ...log,
      lines: linesByLogId[log.id] ?? []
    }));

    return successResult(result, correlationId);
  } catch (error) {
    logError('get_cfa_history_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load CFA history.');
  }
}

export async function getCFADayTypeForDate(logDate: string): Promise<Result<CFADayType | null>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.logs.read');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view CFA data.');
    }

    const parsedDate = DateStringSchema.safeParse(logDate);
    if (!parsedDate.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid log date',
        zodFieldErrors(parsedDate.error)
      );
    }

    const date = new Date(`${parsedDate.data}T00:00:00Z`);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;

    const supabase = createServerClient();
    const { data: scheduleRow, error } = await supabase
      .from('schedules')
      .select('schedule_data')
      .eq('year', year)
      .eq('month', month)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const calendar = (scheduleRow?.schedule_data as { calendar?: Record<string, unknown> } | null)?.calendar;
    const resolved = calendar?.[parsedDate.data];

    if (resolved === 'A' || resolved === 'B') {
      return successResult(resolved, correlationId);
    }

    return successResult(null, correlationId);
  } catch (error) {
    logError('get_cfa_day_type_for_date_failed', {
      correlationId,
      logDate,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to determine day type for selected date.');
  }
}

export async function upsertCFADailyLog(input: {
  log_date: string;
  day_type: CFADayType;
  lines: Array<{
    item_id: string;
    received_qty: number;
    leftover_qty: number;
    missed_demand_qty: number;
  }>;
}): Promise<Result<CFADailyLogWithLines>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.logs.write');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to save CFA logs.');
    }

    const parsed = CFADailyLogUpsertSchema.safeParse(input);
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid CFA daily log payload',
        zodFieldErrors(parsed.error)
      );
    }

    const dedupedByItemId = new Map<string, (typeof parsed.data.lines)[number]>();
    for (const line of parsed.data.lines) {
      if (dedupedByItemId.has(line.item_id)) {
        return errorResult(correlationId, 'VALIDATION_ERROR', 'Duplicate item_id in log lines', {
          lines: `Duplicate item_id: ${line.item_id}`
        });
      }
      dedupedByItemId.set(line.item_id, line);
    }

    const lines = [...dedupedByItemId.values()];

    const supabase = createServerClient();

    const { data: items, error: itemsError } = await supabase
      .from('cfa_items')
      .select('item_id')
      .in(
        'item_id',
        lines.map((line) => line.item_id)
      );

    if (itemsError) {
      return errorResult(correlationId, 'DB_ERROR', itemsError.message);
    }

    const existingIds = new Set((items ?? []).map((item) => String(item.item_id)));
    const missingIds = lines.map((line) => line.item_id).filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'One or more item ids do not exist', {
        lines: `Unknown item_id(s): ${missingIds.join(', ')}`
      });
    }

    const { data: existingLog, error: existingError } = await supabase
      .from('cfa_daily_logs')
      .select('*')
      .eq('log_date', parsed.data.log_date)
      .eq('day_type', parsed.data.day_type)
      .maybeSingle();

    if (existingError) {
      return errorResult(correlationId, 'DB_ERROR', existingError.message);
    }

    let oldSnapshot: CFADailyLogWithLines | null = null;
    if (existingLog?.id) {
      oldSnapshot = await getLogWithLines(supabase, String(existingLog.id));
    }

    const period = parsed.data.day_type === 'A' ? 2 : 6;

    let logRow: CFADailyLog | null = null;
    if (existingLog?.id) {
      const { data: updatedLog, error: updateError } = await supabase
        .from('cfa_daily_logs')
        .update({
          day_type: parsed.data.day_type,
          period,
          updated_by: 'open_access'
        })
        .eq('id', existingLog.id)
        .select('*')
        .single();

      if (updateError || !updatedLog) {
        return errorResult(correlationId, 'DB_ERROR', updateError?.message ?? 'Unable to update CFA log');
      }

      logRow = updatedLog as CFADailyLog;
    } else {
      const { data: insertedLog, error: insertError } = await supabase
        .from('cfa_daily_logs')
        .insert({
          log_date: parsed.data.log_date,
          day_type: parsed.data.day_type,
          period,
          created_by: 'open_access',
          updated_by: 'open_access'
        })
        .select('*')
        .single();

      if (insertError || !insertedLog) {
        return errorResult(correlationId, 'DB_ERROR', insertError?.message ?? 'Unable to create CFA log');
      }

      logRow = insertedLog as CFADailyLog;
    }

    const { error: deleteError } = await supabase
      .from('cfa_daily_log_lines')
      .delete()
      .eq('log_id', logRow.id);

    if (deleteError) {
      return errorResult(correlationId, 'DB_ERROR', deleteError.message);
    }

    const lineRows = lines.map((line) => ({
      log_id: logRow.id,
      item_id: line.item_id,
      received_qty: line.received_qty,
      leftover_qty: line.leftover_qty,
      missed_demand_qty: line.missed_demand_qty
    }));

    const { error: insertLinesError } = await supabase.from('cfa_daily_log_lines').insert(lineRows);
    if (insertLinesError) {
      return errorResult(correlationId, 'DB_ERROR', insertLinesError.message);
    }

    const nextSnapshot = await getLogWithLines(supabase, logRow.id);
    if (!nextSnapshot) {
      return errorResult(correlationId, 'UNKNOWN_ERROR', 'Log saved but could not be reloaded.');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'cfa_daily_log_upserted',
        tableName: 'cfa_daily_logs',
        recordId: logId(nextSnapshot),
        oldValue: oldSnapshot,
        newValue: nextSnapshot,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('cfa_daily_log_upserted', {
      correlationId,
      logDate: parsed.data.log_date,
      dayType: parsed.data.day_type,
      lineCount: nextSnapshot.lines.length
    });

    return successResult(nextSnapshot, correlationId);
  } catch (error) {
    logError('upsert_cfa_daily_log_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to save CFA daily log.');
  }
}

export async function logCFAExport(input: {
  export_type: 'daily_summary' | 'item_level';
  filters: Record<string, unknown>;
}): Promise<Result<{ ok: true }>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('cfa.exports');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to export CFA data.');
    }

    const supabase = createServerClient();
    await insertAuditEntry(
      supabase,
      {
        action: 'cfa_export_performed',
        tableName: 'cfa_daily_logs',
        recordId: input.export_type,
        oldValue: null,
        newValue: {
          export_type: input.export_type,
          filters: input.filters,
          exported_at: new Date().toISOString()
        },
        userId: 'open_access'
      },
      correlationId
    );

    return successResult({ ok: true }, correlationId);
  } catch (error) {
    logError('log_cfa_export_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to record export audit event.');
  }
}
