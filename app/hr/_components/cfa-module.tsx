'use client';

import { useMemo, useState } from 'react';

export type CFATabId = 'daily-log' | 'history' | 'ab-analysis' | 'forecast' | 'menu';
type CFADayType = 'A' | 'B';

type HistoryDayTypeFilter = 'all' | CFADayType;

interface CFATabItem {
  id: CFATabId;
  label: string;
}

interface CFAItem {
  itemId: string;
  name: string;
  buyCostCents: number;
  sellPriceCents: number;
  active: boolean;
  updatedAt: string;
}

interface CFAFormLineDraft {
  receivedQty: number;
  leftoverQty: number;
  missedDemandQty: number;
}

interface CFAComputedLine extends CFAFormLineDraft {
  soldQty: number;
  trueDemandQty: number;
  revenueCents: number;
  cogsCents: number;
  profitCents: number;
  marginPct: number | null;
}

interface CFADailyLogLine extends CFAComputedLine {
  itemId: string;
  itemName: string;
  buyCostCents: number;
  sellPriceCents: number;
}

interface CFADailyLogEntry {
  id: string;
  date: string;
  dayType: CFADayType;
  period: number;
  totalRevenueCents: number;
  totalCogsCents: number;
  totalProfitCents: number;
  stockoutFlag: boolean;
  lines: CFADailyLogLine[];
  updatedAt: string;
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

const DAY_TYPE_OPTIONS: CFADayType[] = ['A', 'B'];

const DEFAULT_CFA_ITEMS: CFAItem[] = [
  {
    itemId: 'strip_sliders',
    name: 'CFA Strip Sliders',
    buyCostCents: 245,
    sellPriceCents: 400,
    active: true,
    updatedAt: new Date().toISOString()
  },
  {
    itemId: 'half_grilled_cool_wrap',
    name: 'CFA Half Grilled Cool Wrap',
    buyCostCents: 349,
    sellPriceCents: 500,
    active: true,
    updatedAt: new Date().toISOString()
  }
];

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateKeyNDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function getSellingPeriod(dayType: CFADayType): number {
  return dayType === 'A' ? 2 : 6;
}

function createInitialDraftByItem(items: CFAItem[]): Record<string, CFAFormLineDraft> {
  return items.reduce<Record<string, CFAFormLineDraft>>((acc, item) => {
    acc[item.itemId] = {
      receivedQty: 0,
      leftoverQty: 0,
      missedDemandQty: 0
    };
    return acc;
  }, {});
}

function toCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100);
}

function toPercent(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function toInteger(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function computeLine(item: CFAItem, draft: CFAFormLineDraft): CFAComputedLine {
  const receivedQty = Math.max(0, draft.receivedQty);
  const leftoverQty = Math.max(0, draft.leftoverQty);
  const missedDemandQty = Math.max(0, draft.missedDemandQty);
  const soldQty = receivedQty - leftoverQty;
  const trueDemandQty = soldQty + missedDemandQty;
  const revenueCents = soldQty * item.sellPriceCents;
  const cogsCents = soldQty * item.buyCostCents;
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

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const asText = String(value);
  if (asText.includes(',') || asText.includes('"') || asText.includes('\n')) {
    return `"${asText.replace(/"/g, '""')}"`;
  }
  return asText;
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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function isCFATab(value: string | null): value is CFATabId {
  return Boolean(value && cfaTabs.some((tab) => tab.id === value));
}

export function CFAModule({ activeTab, onTabChange }: CFAModuleProps) {
  const [items, setItems] = useState<CFAItem[]>(DEFAULT_CFA_ITEMS);
  const [logs, setLogs] = useState<CFADailyLogEntry[]>([]);

  const [logDate, setLogDate] = useState(todayDateKey());
  const [logDayType, setLogDayType] = useState<CFADayType>('A');
  const [lineDraftByItem, setLineDraftByItem] =
    useState<Record<string, CFAFormLineDraft>>(createInitialDraftByItem(DEFAULT_CFA_ITEMS));
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [lineWarnings, setLineWarnings] = useState<Record<string, string>>({});
  const [dailyLogMessage, setDailyLogMessage] = useState<string | null>(null);

  const [historyFrom, setHistoryFrom] = useState(dateKeyNDaysAgo(30));
  const [historyTo, setHistoryTo] = useState(todayDateKey());
  const [historyDayType, setHistoryDayType] = useState<HistoryDayTypeFilter>('all');
  const [historyItemId, setHistoryItemId] = useState('all');

  const [analysisFrom, setAnalysisFrom] = useState(dateKeyNDaysAgo(90));
  const [analysisTo, setAnalysisTo] = useState(todayDateKey());

  const [newItemDraft, setNewItemDraft] = useState({
    itemId: '',
    name: '',
    buyCostCents: '0',
    sellPriceCents: '0',
    active: true
  });
  const [menuMessage, setMenuMessage] = useState<string | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.active), [items]);

  const computedDraftLines = useMemo(() => {
    return activeItems.map((item) => {
      const draft = lineDraftByItem[item.itemId] ?? {
        receivedQty: 0,
        leftoverQty: 0,
        missedDemandQty: 0
      };
      return {
        item,
        computed: computeLine(item, draft)
      };
    });
  }, [activeItems, lineDraftByItem]);

  const draftTotals = useMemo(() => {
    const totalRevenueCents = computedDraftLines.reduce((sum, row) => sum + row.computed.revenueCents, 0);
    const totalCogsCents = computedDraftLines.reduce((sum, row) => sum + row.computed.cogsCents, 0);
    const totalProfitCents = totalRevenueCents - totalCogsCents;
    const stockoutFlag = computedDraftLines.some((row) => row.computed.missedDemandQty > 0);

    return {
      totalRevenueCents,
      totalCogsCents,
      totalProfitCents,
      stockoutFlag
    };
  }, [computedDraftLines]);

  const filteredHistoryLogs = useMemo(() => {
    return [...logs]
      .sort((left, right) => right.date.localeCompare(left.date))
      .filter((log) => {
        if (historyFrom && log.date < historyFrom) return false;
        if (historyTo && log.date > historyTo) return false;
        if (historyDayType !== 'all' && log.dayType !== historyDayType) return false;
        if (historyItemId !== 'all' && !log.lines.some((line) => line.itemId === historyItemId)) return false;
        return true;
      });
  }, [historyDayType, historyFrom, historyItemId, historyTo, logs]);

  const analysisLogs = useMemo(() => {
    return logs.filter((log) => {
      if (analysisFrom && log.date < analysisFrom) return false;
      if (analysisTo && log.date > analysisTo) return false;
      return true;
    });
  }, [analysisFrom, analysisTo, logs]);

  const analysisMetrics = useMemo(() => {
    const byType = {
      A: analysisLogs.filter((log) => log.dayType === 'A'),
      B: analysisLogs.filter((log) => log.dayType === 'B')
    } as const;

    const avgProfitByType = {
      A: average(byType.A.map((log) => log.totalProfitCents)),
      B: average(byType.B.map((log) => log.totalProfitCents))
    };

    const stockoutFrequencyByType = {
      A: byType.A.length > 0 ? byType.A.filter((log) => log.stockoutFlag).length / byType.A.length : null,
      B: byType.B.length > 0 ? byType.B.filter((log) => log.stockoutFlag).length / byType.B.length : null
    };

    const itemRows = items.map((item) => {
      const aLines = byType.A.flatMap((log) => log.lines.filter((line) => line.itemId === item.itemId));
      const bLines = byType.B.flatMap((log) => log.lines.filter((line) => line.itemId === item.itemId));

      return {
        itemId: item.itemId,
        itemName: item.name,
        avgSoldA: average(aLines.map((line) => line.soldQty)),
        avgSoldB: average(bLines.map((line) => line.soldQty)),
        avgDemandA: average(aLines.map((line) => line.trueDemandQty)),
        avgDemandB: average(bLines.map((line) => line.trueDemandQty))
      };
    });

    return {
      totalADays: byType.A.length,
      totalBDays: byType.B.length,
      avgProfitByType,
      stockoutFrequencyByType,
      itemRows
    };
  }, [analysisLogs, items]);

  const forecastRows = useMemo(() => {
    const sortedLogs = [...logs].sort((left, right) => right.date.localeCompare(left.date));

    const buildRollingAverage = (itemId: string, dayType: CFADayType) => {
      const values = sortedLogs
        .filter((log) => log.dayType === dayType)
        .map((log) => log.lines.find((line) => line.itemId === itemId)?.trueDemandQty ?? null)
        .filter((value): value is number => value !== null)
        .slice(0, 3);

      return average(values);
    };

    return activeItems.flatMap((item) => {
      return DAY_TYPE_OPTIONS.map((dayType) => {
        const rollingAvg3 = buildRollingAverage(item.itemId, dayType);
        const recommendedStockQty = rollingAvg3 === null ? null : Math.ceil(rollingAvg3);
        const expectedProfitCents =
          recommendedStockQty === null ? null : recommendedStockQty * (item.sellPriceCents - item.buyCostCents);

        return {
          itemId: item.itemId,
          itemName: item.name,
          dayType,
          rollingAvg3,
          recommendedStockQty,
          expectedProfitCents
        };
      });
    });
  }, [activeItems, logs]);

  const updateLineDraft = (itemId: string, field: keyof CFAFormLineDraft, value: string) => {
    const integerValue = toInteger(value);

    setLineDraftByItem((previous) => ({
      ...previous,
      [itemId]: {
        receivedQty: previous[itemId]?.receivedQty ?? 0,
        leftoverQty: previous[itemId]?.leftoverQty ?? 0,
        missedDemandQty: previous[itemId]?.missedDemandQty ?? 0,
        [field]: integerValue
      }
    }));

    setDailyLogMessage(null);
  };

  const resetDraftLines = () => {
    setLineDraftByItem(createInitialDraftByItem(items));
    setLineErrors({});
    setLineWarnings({});
  };

  const saveDailyLog = () => {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};

    const lines: CFADailyLogLine[] = activeItems.map((item) => {
      const draft = lineDraftByItem[item.itemId] ?? {
        receivedQty: 0,
        leftoverQty: 0,
        missedDemandQty: 0
      };
      const computed = computeLine(item, draft);

      if (computed.leftoverQty > computed.receivedQty) {
        errors[item.itemId] = 'Leftover quantity cannot exceed received quantity.';
      }

      if (computed.receivedQty === 0 && (computed.leftoverQty > 0 || computed.missedDemandQty > 0)) {
        warnings[item.itemId] = 'Received is 0 while another value is greater than 0.';
      }

      return {
        itemId: item.itemId,
        itemName: item.name,
        buyCostCents: item.buyCostCents,
        sellPriceCents: item.sellPriceCents,
        ...computed
      };
    });

    setLineErrors(errors);
    setLineWarnings(warnings);

    if (Object.keys(errors).length > 0) {
      setDailyLogMessage('Fix validation errors before saving.');
      return;
    }

    const totalRevenueCents = lines.reduce((sum, line) => sum + line.revenueCents, 0);
    const totalCogsCents = lines.reduce((sum, line) => sum + line.cogsCents, 0);
    const totalProfitCents = totalRevenueCents - totalCogsCents;
    const stockoutFlag = lines.some((line) => line.missedDemandQty > 0);

    const nextEntry: CFADailyLogEntry = {
      id: `${logDate}-${logDayType}`,
      date: logDate,
      dayType: logDayType,
      period: getSellingPeriod(logDayType),
      totalRevenueCents,
      totalCogsCents,
      totalProfitCents,
      stockoutFlag,
      lines,
      updatedAt: new Date().toISOString()
    };

    setLogs((previous) => {
      const existingIndex = previous.findIndex((entry) => entry.date === logDate && entry.dayType === logDayType);
      if (existingIndex === -1) return [nextEntry, ...previous];

      const copy = [...previous];
      copy[existingIndex] = nextEntry;
      return copy;
    });

    const wasEdit = logs.some((entry) => entry.date === logDate && entry.dayType === logDayType);
    setDailyLogMessage(wasEdit ? 'Daily log updated for this date/dayType.' : 'Daily log saved.');
  };

  const loadExistingDailyLog = () => {
    const existing = logs.find((entry) => entry.date === logDate && entry.dayType === logDayType);
    if (!existing) {
      resetDraftLines();
      setDailyLogMessage('No previous log found for this date/dayType.');
      return;
    }

    const nextDrafts: Record<string, CFAFormLineDraft> = createInitialDraftByItem(items);
    for (const line of existing.lines) {
      nextDrafts[line.itemId] = {
        receivedQty: line.receivedQty,
        leftoverQty: line.leftoverQty,
        missedDemandQty: line.missedDemandQty
      };
    }

    setLineDraftByItem(nextDrafts);
    setLineErrors({});
    setLineWarnings({});
    setDailyLogMessage('Loaded existing log into the Daily Log form.');
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

    for (const log of filteredHistoryLogs) {
      rows.push([
        log.date,
        log.dayType,
        log.period,
        log.totalRevenueCents,
        log.totalCogsCents,
        log.totalProfitCents,
        log.stockoutFlag
      ]);
    }

    downloadCsv('cfa_daily_summary.csv', rows);
  };

  const rollingAverage3SameType = (currentLog: CFADailyLogEntry, itemId: string): number | null => {
    const previousValues = logs
      .filter((log) => log.dayType === currentLog.dayType && log.date < currentLog.date)
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((log) => log.lines.find((line) => line.itemId === itemId)?.trueDemandQty ?? null)
      .filter((value): value is number => value !== null)
      .slice(0, 3);

    return average(previousValues);
  };

  const exportItemLevelCsv = () => {
    const rows: Array<Array<string | number | boolean | null>> = [
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
        'rolling_avg_3_sameType'
      ]
    ];

    const orderedLogs = [...filteredHistoryLogs].sort((left, right) => left.date.localeCompare(right.date));

    for (const log of orderedLogs) {
      const weekday = new Date(`${log.date}T00:00:00`).getDay();
      const month = Number(log.date.slice(5, 7));

      for (const line of log.lines) {
        if (historyItemId !== 'all' && line.itemId !== historyItemId) continue;

        const rolling = rollingAverage3SameType(log, line.itemId);
        rows.push([
          log.date,
          log.dayType,
          log.period,
          line.itemId,
          line.itemName,
          line.receivedQty,
          line.leftoverQty,
          line.soldQty,
          line.missedDemandQty,
          line.trueDemandQty,
          line.sellPriceCents,
          line.buyCostCents,
          line.revenueCents,
          line.cogsCents,
          line.profitCents,
          weekday,
          month,
          rolling === null ? null : Number(rolling.toFixed(2))
        ]);
      }
    }

    downloadCsv('cfa_item_level_regression_ready.csv', rows);
  };

  const updateMenuItem = <K extends keyof CFAItem>(itemId: string, field: K, value: CFAItem[K]) => {
    setItems((previous) =>
      previous.map((item) => {
        if (item.itemId !== itemId) return item;
        return {
          ...item,
          [field]: value,
          updatedAt: new Date().toISOString()
        };
      })
    );
    setMenuMessage('Menu item updated locally.');
  };

  const addMenuItem = () => {
    const itemId = newItemDraft.itemId.trim();
    const name = newItemDraft.name.trim();
    const buyCostCents = toInteger(newItemDraft.buyCostCents);
    const sellPriceCents = toInteger(newItemDraft.sellPriceCents);

    if (!itemId || !/^[a-z0-9_]+$/.test(itemId)) {
      setMenuMessage('Item ID must use lowercase letters, numbers, and underscores only.');
      return;
    }

    if (!name) {
      setMenuMessage('Item name is required.');
      return;
    }

    if (items.some((item) => item.itemId === itemId)) {
      setMenuMessage('Item ID already exists.');
      return;
    }

    setItems((previous) => [
      ...previous,
      {
        itemId,
        name,
        buyCostCents,
        sellPriceCents,
        active: newItemDraft.active,
        updatedAt: new Date().toISOString()
      }
    ]);

    setLineDraftByItem((previous) => ({
      ...previous,
      [itemId]: {
        receivedQty: 0,
        leftoverQty: 0,
        missedDemandQty: 0
      }
    }));

    setNewItemDraft({
      itemId: '',
      name: '',
      buyCostCents: '0',
      sellPriceCents: '0',
      active: true
    });

    if (sellPriceCents < buyCostCents) {
      setMenuMessage('Item added with warning: sell price is below buy cost.');
      return;
    }

    setMenuMessage('Item added to menu.');
  };

  return (
    <section>
      <header className="border-b border-neutral-300 p-4">
        <h2 className="text-lg font-semibold text-neutral-900">Chick-fil-A Module</h2>
        <p className="mt-1 text-sm text-neutral-700">
          Daily operations logging, analytics, forecast planning, and menu controls.
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

      <section aria-labelledby={`cfa-tab-${activeTab}`} className="space-y-4 p-3 md:p-5" id={`cfa-panel-${activeTab}`} role="tabpanel">
        {activeTab === 'daily-log' && (
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
                  className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => {
                    setLogDayType(event.target.value as CFADayType);
                    setDailyLogMessage(null);
                  }}
                  value={logDayType}
                >
                  {DAY_TYPE_OPTIONS.map((dayType) => (
                    <option key={dayType} value={dayType}>
                      {dayType}
                    </option>
                  ))}
                </select>
              </label>

              <div className="text-sm font-medium text-neutral-800">
                Period
                <p className="mt-1 border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900">
                  {getSellingPeriod(logDayType)}
                </p>
              </div>

              <div className="flex items-end gap-2">
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={loadExistingDailyLog}
                  type="button"
                >
                  Load Existing
                </button>
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={resetDraftLines}
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
                  {computedDraftLines.map(({ item, computed }) => (
                    <tr className="align-top" key={item.itemId}>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{item.name}</td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) => updateLineDraft(item.itemId, 'receivedQty', event.target.value)}
                          type="number"
                          value={computed.receivedQty}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) => updateLineDraft(item.itemId, 'leftoverQty', event.target.value)}
                          type="number"
                          value={computed.leftoverQty}
                        />
                        {lineErrors[item.itemId] && (
                          <p className="mt-1 text-xs text-red-700">{lineErrors[item.itemId]}</p>
                        )}
                        {lineWarnings[item.itemId] && (
                          <p className="mt-1 text-xs text-amber-700">{lineWarnings[item.itemId]}</p>
                        )}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-20 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) => updateLineDraft(item.itemId, 'missedDemandQty', event.target.value)}
                          type="number"
                          value={computed.missedDemandQty}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{computed.soldQty}</td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{computed.trueDemandQty}</td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toCurrency(computed.revenueCents)}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{toCurrency(computed.cogsCents)}</td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                        {toCurrency(computed.profitCents)}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{toPercent(computed.marginPct)}</td>
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
                <p className="mt-2 text-lg font-semibold text-neutral-900">{draftTotals.stockoutFlag ? 'Yes' : 'No'}</p>
              </article>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="min-h-[44px] min-w-[44px] border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000]"
                onClick={saveDailyLog}
                type="button"
              >
                Save Daily Log
              </button>
              {dailyLogMessage && <p className="text-sm text-neutral-700">{dailyLogMessage}</p>}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
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
                    <option key={item.itemId} value={item.itemId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={exportDailySummaryCsv}
                  type="button"
                >
                  Export Daily CSV
                </button>
                <button
                  className="min-h-[44px] min-w-[44px] border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:border-brand-maroon"
                  onClick={exportItemLevelCsv}
                  type="button"
                >
                  Export Item CSV
                </button>
              </div>
            </section>

            {filteredHistoryLogs.length === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                No logs found for the selected filters.
              </p>
            ) : (
              <section className="space-y-3">
                {filteredHistoryLogs.map((log) => (
                  <details className="border border-neutral-300 bg-white" key={log.id}>
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-900">
                      {log.date} | Day {log.dayType} | Period {log.period} | Revenue {toCurrency(log.totalRevenueCents)} |
                      Profit {toCurrency(log.totalProfitCents)}
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
                            <tr key={`${log.id}-${line.itemId}`}>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.itemName}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.receivedQty}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.leftoverQty}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.soldQty}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.missedDemandQty}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{line.trueDemandQty}</td>
                              <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">{toCurrency(line.profitCents)}</td>
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

        {activeTab === 'ab-analysis' && (
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

            {analysisMetrics.totalADays === 0 || analysisMetrics.totalBDays === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                Insufficient data. You need both A-day and B-day logs in the selected range.
              </p>
            ) : (
              <>
                <section className="grid gap-3 md:grid-cols-4">
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">A-Day Avg Profit/Day</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {analysisMetrics.avgProfitByType.A === null
                        ? 'N/A'
                        : toCurrency(Math.round(analysisMetrics.avgProfitByType.A))}
                    </p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">B-Day Avg Profit/Day</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {analysisMetrics.avgProfitByType.B === null
                        ? 'N/A'
                        : toCurrency(Math.round(analysisMetrics.avgProfitByType.B))}
                    </p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">A-Day Stockout Frequency</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {toPercent(analysisMetrics.stockoutFrequencyByType.A)}
                    </p>
                  </article>
                  <article className="border border-neutral-300 bg-neutral-50 p-3">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-600">B-Day Stockout Frequency</h3>
                    <p className="mt-2 text-lg font-semibold text-neutral-900">
                      {toPercent(analysisMetrics.stockoutFrequencyByType.B)}
                    </p>
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
                      </tr>
                    </thead>
                    <tbody>
                      {analysisMetrics.itemRows.map((row) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}
          </div>
        )}

        {activeTab === 'forecast' && (
          <div className="space-y-4">
            <p className="border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
              Forecast uses a rolling average of the last 3 same-dayType true demand entries per item.
            </p>

            {forecastRows.length === 0 ? (
              <p className="border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
                Add and save Daily Logs to generate forecast recommendations.
              </p>
            ) : (
              <section className="overflow-x-auto border border-neutral-300">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-neutral-100 text-left text-neutral-800">
                    <tr>
                      <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Day Type</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Rolling Avg (3)</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Recommended Stock</th>
                      <th className="border-b border-neutral-300 px-3 py-2">Expected Profit</th>
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
                          {row.recommendedStockQty === null ? 'N/A' : row.recommendedStockQty}
                        </td>
                        <td className="border-b border-neutral-300 px-3 py-2 text-neutral-900">
                          {row.expectedProfitCents === null ? 'N/A' : toCurrency(row.expectedProfitCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}

        {activeTab === 'menu' && (
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
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.itemId}>
                      <td className="border-b border-neutral-300 px-3 py-2 font-mono text-neutral-900">{item.itemId}</td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-full border border-neutral-300 px-2 py-1"
                          onChange={(event) => updateMenuItem(item.itemId, 'name', event.target.value)}
                          value={item.name}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-28 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) =>
                            updateMenuItem(item.itemId, 'buyCostCents', toInteger(event.target.value))
                          }
                          type="number"
                          value={item.buyCostCents}
                        />
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <input
                          className="w-28 border border-neutral-300 px-2 py-1"
                          min={0}
                          onChange={(event) =>
                            updateMenuItem(item.itemId, 'sellPriceCents', toInteger(event.target.value))
                          }
                          type="number"
                          value={item.sellPriceCents}
                        />
                        {item.sellPriceCents < item.buyCostCents && (
                          <p className="mt-1 text-xs text-amber-700">Warning: Sell price below buy cost.</p>
                        )}
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-neutral-900">
                          <input
                            checked={item.active}
                            onChange={(event) => updateMenuItem(item.itemId, 'active', event.target.checked)}
                            type="checkbox"
                          />
                          {item.active ? 'Yes' : 'No'}
                        </label>
                      </td>
                      <td className="border-b border-neutral-300 px-3 py-2 text-neutral-700">
                        {new Date(item.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

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
                  className="min-h-[44px] min-w-[44px] border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000]"
                  onClick={addMenuItem}
                  type="button"
                >
                  Add Item
                </button>
                {menuMessage && <p className="text-sm text-neutral-700">{menuMessage}</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    </section>
  );
}
