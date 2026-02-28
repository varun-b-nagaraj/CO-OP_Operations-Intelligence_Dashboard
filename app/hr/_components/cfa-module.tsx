'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  createCFAItem,
  getCFADailyLog,
  getCFADayTypeForDate,
  getCFAHistory,
  getCFAItems,
  logCFAExport,
  upsertCFADailyLog,
  updateCFAItem
} from '@/app/actions/cfa';
import { usePermission } from '@/lib/permissions';
import { CFADayType, CFAItem } from '@/lib/types';

export type CFATabId = 'daily-log' | 'history' | 'ab-analysis' | 'forecast' | 'menu';

type HistoryDayTypeFilter = 'all' | CFADayType;

interface CFATabItem {
  id: CFATabId;
  label: string;
}

interface CFALineDraft {
  receivedQty: number;
  leftoverQty: number;
  missedDemandQty: number;
}

interface MenuDraft {
  name: string;
  buyCostCents: number;
  sellPriceCents: number;
  active: boolean;
}

interface CFAModuleProps {
  activeTab: CFATabId;
  onTabChange: (tab: CFATabId) => void;
}

const cfaTabs: CFATabItem[] = [
  { id: 'daily-log', label: 'Daily Log' },
  { id: 'history', label: 'History' },
  { id: 'ab-analysis', label: 'A/B Analysis' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'menu', label: 'Menu' }
];

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateKeyNDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function toCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100);
}

function toPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function toInteger(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  if (mean === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function itemLabel(itemId: string, itemById: Map<string, CFAItem>): string {
  return itemById.get(itemId)?.name ?? itemId;
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(fileName: string, rows: Array<Array<string | number | boolean | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeDrafts(items: CFAItem[], previous: Record<string, CFALineDraft>): Record<string, CFALineDraft> {
  const next: Record<string, CFALineDraft> = {};
  for (const item of items) {
    next[item.item_id] = previous[item.item_id] ?? {
      receivedQty: 0,
      leftoverQty: 0,
      missedDemandQty: 0
    };
  }
  return next;
}

function calculateLineMetrics(item: CFAItem, draft: CFALineDraft) {
  const receivedQty = Math.max(0, draft.receivedQty);
  const leftoverQty = Math.max(0, draft.leftoverQty);
  const missedDemandQty = Math.max(0, draft.missedDemandQty);
  const soldQty = receivedQty - leftoverQty;
  const trueDemandQty = soldQty + missedDemandQty;
  const revenueCents = soldQty * item.sell_price_cents;
  const cogsCents = soldQty * item.buy_cost_cents;
  const profitCents = revenueCents - cogsCents;
  const marginPct = revenueCents > 0 ? profitCents / revenueCents : null;

  return {
    receivedQty,
    leftoverQty,
    missedDemandQty,
    soldQty,
    trueDemandQty,
    revenueCents,
    cogsCents,
    profitCents,
    marginPct
  };
}

function weekdayFromDateKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

export function isCFATab(value: string | null): value is CFATabId {
  return Boolean(value && cfaTabs.some((tab) => tab.id === value));
}

export function CFAModule({ activeTab, onTabChange }: CFAModuleProps) {
  const canReadLogs = usePermission('cfa.logs.read');
  const canWriteLogs = usePermission('cfa.logs.write');
  const canManageMenu = usePermission('cfa.menu.manage');
  const canOverrideDayType = usePermission('cfa.day_type.override');
  const canExport = usePermission('cfa.exports');

  const queryClient = useQueryClient();

  const [logDate, setLogDate] = useState(todayDateKey());
  const [logDayType, setLogDayType] = useState<CFADayType>('A');
  const [dailyLogMessage, setDailyLogMessage] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [lineWarnings, setLineWarnings] = useState<Record<string, string>>({});
  const [lineDraftByItem, setLineDraftByItem] = useState<Record<string, CFALineDraft>>({});

  const [historyFrom, setHistoryFrom] = useState(dateKeyNDaysAgo(30));
  const [historyTo, setHistoryTo] = useState(todayDateKey());
  const [historyDayType, setHistoryDayType] = useState<HistoryDayTypeFilter>('all');
  const [historyItemId, setHistoryItemId] = useState('all');

  const [analysisFrom, setAnalysisFrom] = useState(dateKeyNDaysAgo(90));
  const [analysisTo, setAnalysisTo] = useState(todayDateKey());

  const [menuMessage, setMenuMessage] = useState<string | null>(null);
  const [menuDraftByItem, setMenuDraftByItem] = useState<Record<string, MenuDraft>>({});
  const [newItemDraft, setNewItemDraft] = useState({
    itemId: '',
    name: '',
    buyCostCents: '0',
    sellPriceCents: '0',
    active: true
  });

  const itemsQuery = useQuery({
    queryKey: ['cfa-items'],
    queryFn: async () => {
      const result = await getCFAItems(true);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const autoDayTypeQuery = useQuery({
    queryKey: ['cfa-day-type', logDate],
    enabled: canReadLogs,
    queryFn: async () => {
      const result = await getCFADayTypeForDate(logDate);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const existingLogQuery = useQuery({
    queryKey: ['cfa-daily-log', logDate, logDayType],
    enabled: canReadLogs,
    queryFn: async () => {
      const result = await getCFADailyLog(logDate, logDayType);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const historyQuery = useQuery({
    queryKey: ['cfa-history', historyFrom, historyTo, historyDayType],
    enabled: canReadLogs,
    queryFn: async () => {
      const result = await getCFAHistory({
        from: historyFrom,
        to: historyTo,
        dayType: historyDayType
      });
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const analysisQuery = useQuery({
    queryKey: ['cfa-analysis', analysisFrom, analysisTo],
    enabled: canReadLogs,
    queryFn: async () => {
      const result = await getCFAHistory({
        from: analysisFrom,
        to: analysisTo,
        dayType: 'all'
      });
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const forecastQuery = useQuery({
    queryKey: ['cfa-forecast-dataset'],
    enabled: canReadLogs,
    queryFn: async () => {
      const result = await getCFAHistory({
        from: dateKeyNDaysAgo(365),
        to: todayDateKey(),
        dayType: 'all'
      });
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    }
  });

  const saveLogMutation = useMutation({
    mutationFn: async (input: {
      log_date: string;
      day_type: CFADayType;
      lines: Array<{ item_id: string; received_qty: number; leftover_qty: number; missed_demand_qty: number }>;
    }) => {
      const result = await upsertCFADailyLog(input);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (saved) => {
      setDailyLogMessage(`Saved daily log for ${saved.log_date} (${saved.day_type}-day).`);
      queryClient.invalidateQueries({ queryKey: ['cfa-daily-log'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-history'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-analysis'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-forecast-dataset'] });
    },
    onError: (error) => {
      setDailyLogMessage(error instanceof Error ? error.message : 'Unable to save daily log.');
    }
  });

  const updateItemMutation = useMutation({
    mutationFn: async (input: {
      itemId: string;
      payload: { name: string; buy_cost_cents: number; sell_price_cents: number; active: boolean };
    }) => {
      const result = await updateCFAItem(input.itemId, input.payload);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (updated) => {
      setMenuMessage(`Saved menu item ${updated.name}.`);
      queryClient.invalidateQueries({ queryKey: ['cfa-items'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-history'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-analysis'] });
      queryClient.invalidateQueries({ queryKey: ['cfa-forecast-dataset'] });
    },
    onError: (error) => {
      setMenuMessage(error instanceof Error ? error.message : 'Unable to update menu item.');
    }
  });

  const addItemMutation = useMutation({
    mutationFn: async (input: {
      item_id: string;
      name: string;
      buy_cost_cents: number;
      sell_price_cents: number;
      active: boolean;
    }) => {
      const result = await createCFAItem(input);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (created) => {
      setMenuMessage(`Added menu item ${created.name}.`);
      queryClient.invalidateQueries({ queryKey: ['cfa-items'] });
      setNewItemDraft({
        itemId: '',
        name: '',
        buyCostCents: '0',
        sellPriceCents: '0',
        active: true
      });
    },
    onError: (error) => {
      setMenuMessage(error instanceof Error ? error.message : 'Unable to add menu item.');
    }
  });

  const exportAuditMutation = useMutation({
    mutationFn: async (payload: { export_type: 'daily_summary' | 'item_level'; filters: Record<string, unknown> }) => {
      const result = await logCFAExport(payload);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemById = useMemo(() => {
    const map = new Map<string, CFAItem>();
    for (const item of items) {
      map.set(item.item_id, item);
    }
    return map;
  }, [items]);

  const activeItems = useMemo(() => items.filter((item) => item.active), [items]);

  useEffect(() => {
    if ((itemsQuery.data ?? []).length === 0) return;
    setLineDraftByItem((previous) => normalizeDrafts(activeItems, previous));
  }, [activeItems, itemsQuery.data]);

  useEffect(() => {
    if (!items.length) return;
    setMenuDraftByItem((previous) => {
      const next: Record<string, MenuDraft> = {};
      for (const item of items) {
        next[item.item_id] = previous[item.item_id] ?? {
          name: item.name,
          buyCostCents: item.buy_cost_cents,
          sellPriceCents: item.sell_price_cents,
          active: item.active
        };
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (autoDayTypeQuery.data) {
      setLogDayType(autoDayTypeQuery.data);
    }
  }, [autoDayTypeQuery.data]);

  const dayTypeLocked = Boolean(autoDayTypeQuery.data) && !canOverrideDayType;

  const draftRows = useMemo(() => {
    return activeItems.map((item) => {
      const draft = lineDraftByItem[item.item_id] ?? {
        receivedQty: 0,
        leftoverQty: 0,
        missedDemandQty: 0
      };
      const metrics = calculateLineMetrics(item, draft);
      return {
        item,
        draft,
        metrics
      };
    });
  }, [activeItems, lineDraftByItem]);

  const draftTotals = useMemo(() => {
    const totalRevenueCents = draftRows.reduce((sum, row) => sum + row.metrics.revenueCents, 0);
    const totalCogsCents = draftRows.reduce((sum, row) => sum + row.metrics.cogsCents, 0);
    const totalProfitCents = totalRevenueCents - totalCogsCents;
    const stockoutFlag = draftRows.some((row) => row.metrics.missedDemandQty > 0);
    return { totalRevenueCents, totalCogsCents, totalProfitCents, stockoutFlag };
  }, [draftRows]);

  const historyLogs = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  const historyLogsWithItemFilter = useMemo(() => {
    if (historyItemId === 'all') return historyLogs;

    return historyLogs
      .map((log) => ({
        ...log,
        lines: log.lines.filter((line) => line.item_id === historyItemId)
      }))
      .filter((log) => log.lines.length > 0);
  }, [historyItemId, historyLogs]);

  const analysisLogs = useMemo(() => analysisQuery.data ?? [], [analysisQuery.data]);
  const analysisMetrics = useMemo(() => {
    const aLogs = analysisLogs.filter((log) => log.day_type === 'A');
    const bLogs = analysisLogs.filter((log) => log.day_type === 'B');

    const buildForItem = (item: CFAItem) => {
      const aLines = aLogs.flatMap((log) => log.lines.filter((line) => line.item_id === item.item_id));
      const bLines = bLogs.flatMap((log) => log.lines.filter((line) => line.item_id === item.item_id));

      const stockoutA =
        aLogs.length === 0
          ? null
          : aLogs.filter((log) =>
              log.lines.some((line) => line.item_id === item.item_id && line.missed_demand_qty > 0)
            ).length / aLogs.length;

      const stockoutB =
        bLogs.length === 0
          ? null
          : bLogs.filter((log) =>
              log.lines.some((line) => line.item_id === item.item_id && line.missed_demand_qty > 0)
            ).length / bLogs.length;

      return {
        itemId: item.item_id,
        itemName: item.name,
        avgSoldA: average(aLines.map((line) => line.sold_qty)),
        avgSoldB: average(bLines.map((line) => line.sold_qty)),
        avgDemandA: average(aLines.map((line) => line.true_demand_qty)),
        avgDemandB: average(bLines.map((line) => line.true_demand_qty)),
        stockoutA,
        stockoutB
      };
    };

    return {
      totalADays: aLogs.length,
      totalBDays: bLogs.length,
      avgProfitA: average(aLogs.map((log) => log.total_profit_cents)),
      avgProfitB: average(bLogs.map((log) => log.total_profit_cents)),
      stockoutA: aLogs.length === 0 ? null : aLogs.filter((log) => log.stockout_flag).length / aLogs.length,
      stockoutB: bLogs.length === 0 ? null : bLogs.filter((log) => log.stockout_flag).length / bLogs.length,
      rows: items.map(buildForItem)
    };
  }, [analysisLogs, items]);

  const forecastRows = useMemo(() => {
    const logs = [...(forecastQuery.data ?? [])].sort((left, right) => right.log_date.localeCompare(left.log_date));

    return activeItems.flatMap((item) => {
      return (['A', 'B'] as CFADayType[]).map((dayType) => {
        const historyValues = logs
          .filter((log) => log.day_type === dayType)
          .map((log) => log.lines.find((line) => line.item_id === item.item_id)?.true_demand_qty ?? null)
          .filter((value): value is number => value !== null);

        const rollingAvg3 = average(historyValues.slice(0, 3));
        const rollingAvg5 = average(historyValues.slice(0, 5));
        const prevSameTypeDemand = historyValues[0] ?? null;
        const recommendation = rollingAvg3 === null ? null : Math.ceil(rollingAvg3);
        const expectedProfitCents =
          recommendation === null ? null : recommendation * (item.sell_price_cents - item.buy_cost_cents);
        const confidenceBand = standardDeviation(historyValues.slice(0, 6));

        return {
          itemId: item.item_id,
          itemName: item.name,
          dayType,
          rollingAvg3,
          rollingAvg5,
          prevSameTypeDemand,
          recommendation,
          expectedProfitCents,
          confidenceBand
        };
      });
    });
  }, [activeItems, forecastQuery.data]);

  const setLineValue = (itemId: string, key: keyof CFALineDraft, value: string) => {
    const asInt = toInteger(value);
    setLineDraftByItem((previous) => ({
      ...previous,
      [itemId]: {
        receivedQty: previous[itemId]?.receivedQty ?? 0,
        leftoverQty: previous[itemId]?.leftoverQty ?? 0,
        missedDemandQty: previous[itemId]?.missedDemandQty ?? 0,
        [key]: asInt
      }
    }));
    setDailyLogMessage(null);
  };

  const resetLineDrafts = () => {
    setLineDraftByItem(normalizeDrafts(activeItems, {}));
    setLineErrors({});
    setLineWarnings({});
    setDailyLogMessage('Draft reset.');
  };

  const loadExistingLog = () => {
    const existing = existingLogQuery.data;
    if (!existing) {
      resetLineDrafts();
      setDailyLogMessage('No saved log exists for this date/day type.');
      return;
    }

    const nextDrafts: Record<string, CFALineDraft> = normalizeDrafts(activeItems, {});
    for (const line of existing.lines) {
      nextDrafts[line.item_id] = {
        receivedQty: line.received_qty,
        leftoverQty: line.leftover_qty,
        missedDemandQty: line.missed_demand_qty
      };
    }

    setLineDraftByItem(nextDrafts);
    setLineErrors({});
    setLineWarnings({});
    setDailyLogMessage('Existing log loaded into Daily Log form.');
  };

  const saveDailyLog = () => {
    if (!canWriteLogs) {
      setDailyLogMessage('You do not have permission to save logs.');
      return;
    }

    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};

    for (const row of draftRows) {
      if (row.metrics.leftoverQty > row.metrics.receivedQty) {
        errors[row.item.item_id] = 'Leftover quantity cannot exceed received quantity.';
      }

      if (row.metrics.receivedQty === 0 && (row.metrics.leftoverQty > 0 || row.metrics.missedDemandQty > 0)) {
        warnings[row.item.item_id] = 'Received is 0 while another quantity is greater than 0.';
      }

      if (row.metrics.receivedQty > 0 && row.metrics.leftoverQty === 0 && row.metrics.missedDemandQty === 0) {
        warnings[row.item.item_id] = 'Sold out detected. Consider entering missed demand if customers asked after sell-out.';
      }
    }

    setLineErrors(errors);
    setLineWarnings(warnings);

    if (Object.keys(errors).length > 0) {
      setDailyLogMessage('Fix validation errors before saving.');
      return;
    }

    const payloadLines = draftRows.map((row) => ({
      item_id: row.item.item_id,
      received_qty: row.metrics.receivedQty,
      leftover_qty: row.metrics.leftoverQty,
      missed_demand_qty: row.metrics.missedDemandQty
    }));

    saveLogMutation.mutate({
      log_date: logDate,
      day_type: logDayType,
      lines: payloadLines
    });
  };

  const exportDailySummaryCsv = () => {
    const rows: Array<Array<string | number | boolean>> = [
      [
        'date',
        'dayType',
        'period',
        'totalRevenueCents',
        'totalCogsCents',
        'totalProfitCents',
        'stockoutFlag'
      ]
    ];

    for (const log of historyLogs) {
      rows.push([
        log.log_date,
        log.day_type,
        log.period,
        log.total_revenue_cents,
        log.total_cogs_cents,
        log.total_profit_cents,
        log.stockout_flag
      ]);
    }

    downloadCsv('cfa_daily_summary.csv', rows);

    if (canExport) {
      exportAuditMutation.mutate({
        export_type: 'daily_summary',
        filters: { from: historyFrom, to: historyTo, dayType: historyDayType }
      });
    }
  };

  const exportItemLevelCsv = () => {
    const orderedLogs = [...historyLogsWithItemFilter].sort((left, right) =>
      left.log_date.localeCompare(right.log_date)
    );

    const rows: Array<Array<string | number | null>> = [
      [
        'date',
        'dayType',
        'period',
        'itemId',
        'itemName',
        'receivedQty',
        'leftoverQty',
        'soldQty',
        'missedDemandQty',
        'trueDemandQty',
        'sellPriceCents',
        'buyCostCents',
        'revenueCents',
        'cogsCents',
        'profitCents',
        'weekday',
        'month',
        'rolling_avg_3_sameType',
        'rolling_avg_5_sameType',
        'prev_sameType_demand'
      ]
    ];

    const rollingByItemType = new Map<string, number[]>();

    for (const log of orderedLogs) {
      for (const line of log.lines) {
        const key = `${line.item_id}|${log.day_type}`;
        const previous = rollingByItemType.get(key) ?? [];
        const rolling3 = average(previous.slice(-3));
        const rolling5 = average(previous.slice(-5));
        const prevSame = previous.length > 0 ? previous[previous.length - 1] : null;

        rows.push([
          log.log_date,
          log.day_type,
          log.period,
          line.item_id,
          itemLabel(line.item_id, itemById),
          line.received_qty,
          line.leftover_qty,
          line.sold_qty,
          line.missed_demand_qty,
          line.true_demand_qty,
          line.sell_price_cents,
          line.buy_cost_cents,
          line.revenue_cents,
          line.cogs_cents,
          line.profit_cents,
          weekdayFromDateKey(log.log_date),
          Number(log.log_date.slice(5, 7)),
          rolling3 === null ? null : Number(rolling3.toFixed(2)),
          rolling5 === null ? null : Number(rolling5.toFixed(2)),
          prevSame
        ]);

        previous.push(line.true_demand_qty);
        rollingByItemType.set(key, previous);
      }
    }

    downloadCsv('cfa_item_level_regression_ready.csv', rows);

    if (canExport) {
      exportAuditMutation.mutate({
        export_type: 'item_level',
        filters: {
          from: historyFrom,
          to: historyTo,
          dayType: historyDayType,
          itemId: historyItemId
        }
      });
    }
  };

  const saveMenuItem = (itemId: string) => {
    if (!canManageMenu) return;

    const draft = menuDraftByItem[itemId];
    if (!draft) return;

    updateItemMutation.mutate({
      itemId,
      payload: {
        name: draft.name.trim(),
        buy_cost_cents: toInteger(draft.buyCostCents),
        sell_price_cents: toInteger(draft.sellPriceCents),
        active: draft.active
      }
    });
  };

  const addMenuItem = () => {
    if (!canManageMenu) return;

    const item_id = newItemDraft.itemId.trim();
    const name = newItemDraft.name.trim();
    const buy_cost_cents = toInteger(newItemDraft.buyCostCents);
    const sell_price_cents = toInteger(newItemDraft.sellPriceCents);

    if (!/^[a-z0-9_]+$/.test(item_id)) {
      setMenuMessage('Item ID must use lowercase letters, numbers, and underscores only.');
      return;
    }

    if (!name) {
      setMenuMessage('Item name is required.');
      return;
    }

    addItemMutation.mutate({
      item_id,
      name,
      buy_cost_cents,
      sell_price_cents,
      active: newItemDraft.active
    });
  };

  return (
    <section>
      <header className="border-b border-neutral-300 p-4">
        <h2 className="text-lg font-semibold text-neutral-900">Chick-fil-A Dashboard</h2>
        <p className="mt-1 text-sm text-neutral-700">
          Daily logging, history, A/B analytics, forecast recommendations, and menu management.
        </p>
      </header>

      <nav aria-label="Chick-fil-A module tabs" className="border-b border-neutral-300 bg-white" role="tablist">
        <div className="grid grid-cols-2 gap-2 p-2 md:flex md:flex-wrap">
          {cfaTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                aria-controls={`cfa-panel-${tab.id}`}
                aria-selected={isActive}
                className={`min-h-[44px] min-w-[44px] border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'border-brand-maroon bg-brand-maroon text-white'
                    : 'border-neutral-300 bg-white text-neutral-800 hover:border-brand-maroon'
                }`}
                id={`cfa-tab-${tab.id}`}
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <section
        aria-labelledby={`cfa-tab-${activeTab}`}
        className="space-y-4 p-3 md:p-5"
        id={`cfa-panel-${activeTab}`}
        role="tabpanel"
      >
        {!canReadLogs && (
          <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
            You do not have permission to view Chick-fil-A dashboard data.
          </p>
        )}

        {canReadLogs && activeTab === 'daily-log' && (
          <div className="space-y-4">
            <section className="grid gap-3 border border-neutral-300 bg-neutral-50 p-3 md:grid-cols-4">
              <label className="text-sm font-medium text-neutral-800">
                Date
                <input
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => {
                    setLogDate(event.target.value);
                    setDailyLogMessage(null);
                  }}
                  type="date"
                  value={logDate}
                />
              </label>

              <label className="text-sm font-medium text-neutral-800">
                Day Type
                <select
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm disabled:bg-neutral-100"
                  disabled={dayTypeLocked}
                  onChange={(event) => setLogDayType(event.target.value as CFADayType)}
                  value={logDayType}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
                {autoDayTypeQuery.data && !canOverrideDayType && (
                  <p className="mt-1 text-xs text-neutral-600">Day type auto-detected from schedule data.</p>
                )}
              </label>

              <div className="text-sm font-medium text-neutral-800">
                Period
                <p className="mt-1 border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900">
                  {logDayType === 'A' ? 2 : 6}
                </p>
              </div>

              <div className="flex items-end gap-2">
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={loadExistingLog}
                  type="button"
                >
                  Load Existing
                </button>
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={resetLineDrafts}
                  type="button"
                >
                  Reset
                </button>
              </div>
            </section>

            <section className="overflow-x-auto border border-neutral-300">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-neutral-100 text-left text-neutral-800">
                  <tr>
                    <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Received</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Leftover</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Missed Demand</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Sold</th>
                    <th className="border-b border-neutral-300 px-3 py-2">True Demand</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Revenue</th>
                    <th className="border-b border-neutral-300 px-3 py-2">COGS</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Profit</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((row) => (
                    <tr className="align-top" key={row.item.item_id}>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{row.item.name}</td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) => setLineValue(row.item.item_id, 'receivedQty', event.target.value)}
                          type="number"
                          value={row.draft.receivedQty}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) => setLineValue(row.item.item_id, 'leftoverQty', event.target.value)}
                          type="number"
                          value={row.draft.leftoverQty}
                        />
                        {lineErrors[row.item.item_id] && (
                          <p className="mt-1 text-xs text-red-700">{lineErrors[row.item.item_id]}</p>
                        )}
                        {lineWarnings[row.item.item_id] && (
                          <p className="mt-1 text-xs text-amber-700">{lineWarnings[row.item.item_id]}</p>
                        )}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) =>
                            setLineValue(row.item.item_id, 'missedDemandQty', event.target.value)
                          }
                          type="number"
                          value={row.draft.missedDemandQty}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{row.metrics.soldQty}</td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {row.metrics.trueDemandQty}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toCurrency(row.metrics.revenueCents)}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toCurrency(row.metrics.cogsCents)}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toCurrency(row.metrics.profitCents)}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toPercent(row.metrics.marginPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <article className="border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-xs uppercase tracking-wide text-neutral-600">Total Revenue</h3>
                <p className="mt-2 text-lg font-semibold text-neutral-900">{toCurrency(draftTotals.totalRevenueCents)}</p>
              </article>
              <article className="border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-xs uppercase tracking-wide text-neutral-600">Total COGS</h3>
                <p className="mt-2 text-lg font-semibold text-neutral-900">{toCurrency(draftTotals.totalCogsCents)}</p>
              </article>
              <article className="border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-xs uppercase tracking-wide text-neutral-600">Total Profit</h3>
                <p className="mt-2 text-lg font-semibold text-neutral-900">{toCurrency(draftTotals.totalProfitCents)}</p>
              </article>
              <article className="border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-xs uppercase tracking-wide text-neutral-600">Stockout Flag</h3>
                <p className="mt-2 text-lg font-semibold text-neutral-900">
                  {draftTotals.stockoutFlag ? 'Yes' : 'No'}
                </p>
              </article>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="min-h-[44px] min-w-[44px] border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saveLogMutation.isPending || !canWriteLogs}
                onClick={saveDailyLog}
                type="button"
              >
                {saveLogMutation.isPending ? 'Saving...' : 'Save Daily Log'}
              </button>
              {dailyLogMessage && <p className="text-sm text-neutral-700">{dailyLogMessage}</p>}
            </div>
          </div>
        )}

        {canReadLogs && activeTab === 'history' && (
          <div className="space-y-4">
            <section className="grid gap-3 border border-neutral-300 bg-neutral-50 p-3 md:grid-cols-5">
              <label className="text-sm font-medium text-neutral-800">
                From
                <input
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setHistoryFrom(event.target.value)}
                  type="date"
                  value={historyFrom}
                />
              </label>

              <label className="text-sm font-medium text-neutral-800">
                To
                <input
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setHistoryTo(event.target.value)}
                  type="date"
                  value={historyTo}
                />
              </label>

              <label className="text-sm font-medium text-neutral-800">
                Day Type
                <select
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setHistoryDayType(event.target.value as HistoryDayTypeFilter)}
                  value={historyDayType}
                >
                  <option value="all">All</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </label>

              <label className="text-sm font-medium text-neutral-800">
                Item
                <select
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setHistoryItemId(event.target.value)}
                  value={historyItemId}
                >
                  <option value="all">All items</option>
                  {items.map((item) => (
                    <option key={item.item_id} value={item.item_id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end gap-2">
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canExport}
                  onClick={exportDailySummaryCsv}
                  type="button"
                >
                  Export Daily CSV
                </button>
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canExport}
                  onClick={exportItemLevelCsv}
                  type="button"
                >
                  Export Item CSV
                </button>
              </div>
            </section>

            {historyQuery.isPending ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">Loading history...</p>
            ) : historyLogsWithItemFilter.length === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                No logs found for the selected filters.
              </p>
            ) : (
              <section className="space-y-3">
                {historyLogsWithItemFilter.map((log) => (
                  <details className="border border-neutral-300 bg-white" key={`${log.log_date}-${log.day_type}`}>
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-900">
                      {log.log_date} | Day {log.day_type} | Period {log.period} | Revenue{' '}
                      {toCurrency(log.total_revenue_cents)} | Profit {toCurrency(log.total_profit_cents)}
                    </summary>
                    <div className="overflow-x-auto border-t border-neutral-300">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="bg-neutral-100 text-left text-neutral-800">
                          <tr>
                            <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Received</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Leftover</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Sold</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Missed</th>
                            <th className="border-b border-neutral-300 px-3 py-2">True Demand</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {log.lines.map((line) => (
                            <tr key={line.id}>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {itemLabel(line.item_id, itemById)}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {line.received_qty}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {line.leftover_qty}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {line.sold_qty}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {line.missed_demand_qty}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {line.true_demand_qty}
                              </td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                                {toCurrency(line.profit_cents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </section>
            )}
          </div>
        )}

        {canReadLogs && activeTab === 'ab-analysis' && (
          <div className="space-y-4">
            <section className="grid gap-3 border border-neutral-300 bg-neutral-50 p-3 md:grid-cols-2">
              <label className="text-sm font-medium text-neutral-800">
                From
                <input
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setAnalysisFrom(event.target.value)}
                  type="date"
                  value={analysisFrom}
                />
              </label>
              <label className="text-sm font-medium text-neutral-800">
                To
                <input
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setAnalysisTo(event.target.value)}
                  type="date"
                  value={analysisTo}
                />
              </label>
            </section>

            {analysisQuery.isPending ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">Loading analysis...</p>
            ) : analysisMetrics.totalADays === 0 || analysisMetrics.totalBDays === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                Insufficient data. Both A-day and B-day logs are required within the selected range.
              </p>
            ) : (
              <>
                <section className="grid gap-3 md:grid-cols-4">
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">Avg Profit/Day (A)</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {analysisMetrics.avgProfitA === null
                        ? 'N/A'
                        : toCurrency(Math.round(analysisMetrics.avgProfitA))}
                    </p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">Avg Profit/Day (B)</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {analysisMetrics.avgProfitB === null
                        ? 'N/A'
                        : toCurrency(Math.round(analysisMetrics.avgProfitB))}
                    </p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">Stockout Frequency (A)</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">{toPercent(analysisMetrics.stockoutA)}</p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">Stockout Frequency (B)</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">{toPercent(analysisMetrics.stockoutB)}</p>
                  </article>
                </section>

                <section className="overflow-x-auto border border-neutral-300">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-neutral-100 text-left text-neutral-800">
                      <tr>
                        <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Avg Sold (A)</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Avg Sold (B)</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Avg True Demand (A)</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Avg True Demand (B)</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Stockout % (A)</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Stockout % (B)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysisMetrics.rows.map((row) => (
                        <tr key={row.itemId}>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{row.itemName}</td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                            {row.avgSoldA === null ? 'N/A' : row.avgSoldA.toFixed(2)}
                          </td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                            {row.avgSoldB === null ? 'N/A' : row.avgSoldB.toFixed(2)}
                          </td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                            {row.avgDemandA === null ? 'N/A' : row.avgDemandA.toFixed(2)}
                          </td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                            {row.avgDemandB === null ? 'N/A' : row.avgDemandB.toFixed(2)}
                          </td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{toPercent(row.stockoutA)}</td>
                          <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{toPercent(row.stockoutB)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}
          </div>
        )}

        {canReadLogs && activeTab === 'forecast' && (
          <div className="space-y-4">
            <p className="border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
              Forecast baseline uses rolling averages by item/dayType. Recommendation = ceil(rolling_avg_3_sameType).
            </p>

            {forecastQuery.isPending ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">Loading forecast...</p>
            ) : forecastRows.length === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                Add Daily Log data to generate forecast recommendations.
              </p>
            ) : (
              <section className="overflow-x-auto border border-neutral-300">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-neutral-100 text-left text-neutral-800">
                    <tr>
                      <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Day Type</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Rolling Avg (3)</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Rolling Avg (5)</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Prev Same-Type Demand</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Recommended Stock</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Expected Profit</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Confidence Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastRows.map((row) => (
                      <tr key={`${row.itemId}-${row.dayType}`}>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{row.itemName}</td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{row.dayType}</td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.rollingAvg3 === null ? 'N/A' : row.rollingAvg3.toFixed(2)}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.rollingAvg5 === null ? 'N/A' : row.rollingAvg5.toFixed(2)}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.prevSameTypeDemand === null ? 'N/A' : row.prevSameTypeDemand}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.recommendation === null ? 'N/A' : row.recommendation}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.expectedProfitCents === null ? 'N/A' : toCurrency(row.expectedProfitCents)}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.confidenceBand === null ? 'N/A' : `±${row.confidenceBand.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}

        {canReadLogs && activeTab === 'menu' && (
          <div className="space-y-4">
            <section className="overflow-x-auto border border-neutral-300">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-neutral-100 text-left text-neutral-800">
                  <tr>
                    <th className="border-b border-neutral-300 px-3 py-2">Item ID</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Name</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Buy Cost (cents)</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Sell Price (cents)</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Active</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Last Updated</th>
                    <th className="border-b border-neutral-300 px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const draft =
                      menuDraftByItem[item.item_id] ??
                      ({
                        name: item.name,
                        buyCostCents: item.buy_cost_cents,
                        sellPriceCents: item.sell_price_cents,
                        active: item.active
                      } as MenuDraft);

                    return (
                      <tr key={item.item_id}>
                        <td className="border-b border-neutral-300 px-3 py-2 font-mono text-neutral-900">{item.item_id}</td>
                        <td className="border-b border-neutral-300 px-3 py-2">
                          <input
                            className="w-full border border-neutral-300 px-2 py-1 disabled:bg-neutral-100"
                            disabled={!canManageMenu}
                            onChange={(event) =>
                              setMenuDraftByItem((previous) => ({
                                ...previous,
                                [item.item_id]: {
                                  ...draft,
                                  name: event.target.value
                                }
                              }))
                            }
                            value={draft.name}
                          />
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2">
                          <input
                            className="w-28 border border-neutral-300 px-2 py-1 disabled:bg-neutral-100"
                            disabled={!canManageMenu}
                            min={0}
                            onChange={(event) =>
                              setMenuDraftByItem((previous) => ({
                                ...previous,
                                [item.item_id]: {
                                  ...draft,
                                  buyCostCents: toInteger(event.target.value)
                                }
                              }))
                            }
                            type="number"
                            value={draft.buyCostCents}
                          />
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2">
                          <input
                            className="w-28 border border-neutral-300 px-2 py-1 disabled:bg-neutral-100"
                            disabled={!canManageMenu}
                            min={0}
                            onChange={(event) =>
                              setMenuDraftByItem((previous) => ({
                                ...previous,
                                [item.item_id]: {
                                  ...draft,
                                  sellPriceCents: toInteger(event.target.value)
                                }
                              }))
                            }
                            type="number"
                            value={draft.sellPriceCents}
                          />
                          {draft.sellPriceCents < draft.buyCostCents && (
                            <p className="mt-1 text-xs text-amber-700">Warning: Sell price below buy cost.</p>
                          )}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2">
                          <label className="inline-flex items-center gap-2 text-neutral-900">
                            <input
                              checked={draft.active}
                              disabled={!canManageMenu}
                              onChange={(event) =>
                                setMenuDraftByItem((previous) => ({
                                  ...previous,
                                  [item.item_id]: {
                                    ...draft,
                                    active: event.target.checked
                                  }
                                }))
                              }
                              type="checkbox"
                            />
                            {draft.active ? 'Yes' : 'No'}
                          </label>
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-700">
                          {new Date(item.updated_at).toLocaleString()}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2">
                          <button
                            className="min-h-[38px] min-w-[44px] border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-900 hover:border-brand-maroon disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={!canManageMenu || updateItemMutation.isPending}
                            onClick={() => saveMenuItem(item.item_id)}
                            type="button"
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {canManageMenu && (
              <section className="border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-sm font-semibold text-neutral-900">Add Menu Item</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-5">
                  <label className="text-sm font-medium text-neutral-800">
                    Item ID
                    <input
                      className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm font-mono"
                      onChange={(event) =>
                        setNewItemDraft((previous) => ({ ...previous, itemId: event.target.value.trim() }))
                      }
                      placeholder="example_item"
                      value={newItemDraft.itemId}
                    />
                  </label>
                  <label className="text-sm font-medium text-neutral-800">
                    Name
                    <input
                      className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                      onChange={(event) =>
                        setNewItemDraft((previous) => ({ ...previous, name: event.target.value }))
                      }
                      placeholder="Item name"
                      value={newItemDraft.name}
                    />
                  </label>
                  <label className="text-sm font-medium text-neutral-800">
                    Buy Cost (cents)
                    <input
                      className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                      min={0}
                      onChange={(event) =>
                        setNewItemDraft((previous) => ({ ...previous, buyCostCents: event.target.value }))
                      }
                      type="number"
                      value={newItemDraft.buyCostCents}
                    />
                  </label>
                  <label className="text-sm font-medium text-neutral-800">
                    Sell Price (cents)
                    <input
                      className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                      min={0}
                      onChange={(event) =>
                        setNewItemDraft((previous) => ({ ...previous, sellPriceCents: event.target.value }))
                      }
                      type="number"
                      value={newItemDraft.sellPriceCents}
                    />
                  </label>
                  <label className="flex items-end gap-2 text-sm font-medium text-neutral-800">
                    <input
                      checked={newItemDraft.active}
                      onChange={(event) =>
                        setNewItemDraft((previous) => ({ ...previous, active: event.target.checked }))
                      }
                      type="checkbox"
                    />
                    Active
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    className="min-h-[44px] min-w-[44px] border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={addItemMutation.isPending}
                    onClick={addMenuItem}
                    type="button"
                  >
                    {addItemMutation.isPending ? 'Adding...' : 'Add Item'}
                  </button>
                  {menuMessage && <p className="text-sm text-neutral-700">{menuMessage}</p>}
                </div>
              </section>
            )}

            {!canManageMenu && (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                Menu is read-only for your role. CFA Admin, Exec, or Finance permissions are required to edit.
              </p>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
