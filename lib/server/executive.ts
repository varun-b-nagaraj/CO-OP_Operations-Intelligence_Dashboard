import { createServerClient } from '@/lib/supabase';
import { getToolSpecById, planExecutiveTools } from '@/lib/executive/tooling';

export interface ExecutiveSummaryCard {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'neutral' | 'positive' | 'warning';
}

export interface ExecutiveFeedItem {
  id: string;
  department: string;
  title: string;
  detail: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  href: string;
}

export interface ExecutiveAlert {
  id: string;
  title: string;
  department: string;
  severity: 'medium' | 'high';
  description: string;
  action: string;
}

export interface ExecutiveMetric {
  id: string;
  title: string;
  value: string;
  trend: string;
}

export interface ExecutiveReportItem {
  id: string;
  type: string;
  title: string;
  status: string;
  updatedAt: string;
  owner: string;
  href: string;
}

export interface DepartmentHealthItem {
  id: string;
  department: string;
  status: 'healthy' | 'watch' | 'risk';
  summary: string;
}

export interface ExecutiveOverviewData {
  generatedAt: string;
  executiveBrief: string;
  summaryCards: ExecutiveSummaryCard[];
  feed: ExecutiveFeedItem[];
  alerts: ExecutiveAlert[];
  metrics: ExecutiveMetric[];
  reports: ExecutiveReportItem[];
  departmentHealth: DepartmentHealthItem[];
}

export interface ExecutiveToolTraceItem {
  id: string;
  label: string;
  status: 'complete' | 'failed';
  startedAt: string;
  finishedAt: string;
  detail: string;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function orderSeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'partially_received' ? 'warning' : 'info';
}

function financeSeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'failed_validation' ? 'warning' : 'info';
}

function inventorySeverity(status: string): ExecutiveFeedItem['severity'] {
  return status === 'active' ? 'warning' : 'info';
}

type Awaitable<T> = Promise<T> | PromiseLike<T>;

async function safeCount(
  queryFactory: () => Awaitable<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  try {
    const result = await queryFactory();
    if (result.error) return 0;
    return result.count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows<T>(
  queryFactory: () => Awaitable<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  try {
    const result = await queryFactory();
    if (result.error) return [];
    return result.data ?? [];
  } catch {
    return [];
  }
}

type ProductOrderRow = {
  id: string;
  order_number: string | null;
  status: string;
  created_at: string;
  requested_pickup_date: string | null;
};

type FinanceHeaderRow = {
  id: string;
  report_name: string;
  status: string;
  uploaded_by: string | null;
  uploaded_at: string;
  total_collected: number | null;
};

type MarketingEventRow = {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  updated_at: string;
};

type InventorySessionRow = {
  id: string;
  session_name: string;
  status: string;
  updated_at: string;
};

type ShiftAttendanceRow = {
  status: 'expected' | 'present' | 'absent' | 'excused';
  shift_date: string;
};

type CFAHistoryRow = {
  id: string;
  log_date: string;
  created_at: string;
};

type CalendarEventRow = {
  id: string;
  title: string;
  starts_at: string;
  source_department: string | null;
};

export async function fetchExecutiveOverview(): Promise<ExecutiveOverviewData> {
  const supabase = createServerClient();
  const nowIso = new Date().toISOString();
  const weekAgoIso = daysAgoIso(7);

  const [
    newOrdersThisWeek,
    openShiftRequests,
    recentProductOrders,
    shiftAttendanceRows,
    financeHeaders,
    upcomingMarketingEvents,
    inventorySessions,
    cfaLogs,
    upcomingCalendarEvents
  ] = await Promise.all([
    safeCount(() =>
      supabase
        .from('product_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekAgoIso)
    ),
    safeCount(() =>
      supabase
        .from('hr_shift_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
    ),
    safeRows<ProductOrderRow>(() =>
      supabase
        .from('product_purchase_orders')
        .select('id,order_number,status,created_at,requested_pickup_date')
        .order('created_at', { ascending: false })
        .limit(10)
    ),
    safeRows<ShiftAttendanceRow>(() =>
      supabase
        .from('hr_shift_attendance')
        .select('status,shift_date')
        .gte('shift_date', weekAgoIso.slice(0, 10))
        .order('shift_date', { ascending: false })
        .limit(400)
    ),
    safeRows<FinanceHeaderRow>(() =>
      supabase
        .from('finance_report_headers')
        .select('id,report_name,status,uploaded_by,uploaded_at,total_collected')
        .order('uploaded_at', { ascending: false })
        .limit(8)
    ),
    safeRows<MarketingEventRow>(() =>
      supabase
        .from('marketing_events')
        .select('id,title,status,starts_at,updated_at')
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(8)
    ),
    safeRows<InventorySessionRow>(() =>
      supabase
        .from('inventory_sessions')
        .select('id,session_name,status,updated_at')
        .order('updated_at', { ascending: false })
        .limit(8)
    ),
    safeRows<CFAHistoryRow>(() =>
      supabase
        .from('cfa_daily_logs')
        .select('id,log_date,created_at')
        .order('created_at', { ascending: false })
        .limit(8)
    ),
    safeRows<CalendarEventRow>(() =>
      supabase
        .from('general_department_calendar_events')
        .select('id,title,starts_at,source_department')
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(6)
    )
  ]);

  const absentCount = shiftAttendanceRows.filter((row) => row.status === 'absent').length;
  const presentCount = shiftAttendanceRows.filter((row) => row.status === 'present').length;
  const attendanceTotal = absentCount + presentCount;
  const attendanceRate =
    attendanceTotal > 0 ? `${Math.round((presentCount / attendanceTotal) * 100)}%` : 'No recent data';

  const highRiskOrders = recentProductOrders.filter(
    (order) => order.status === 'ordered' || order.status === 'partially_received'
  ).length;
  const financeReportCount = financeHeaders.length;

  const summaryCards: ExecutiveSummaryCard[] = [
    {
      id: 'orders-week',
      title: 'New Product Orders (7d)',
      value: String(newOrdersThisWeek),
      subtitle: 'Placed in the last 7 days',
      tone: 'neutral'
    },
    {
      id: 'attendance-rate',
      title: 'Shift Attendance',
      value: attendanceRate,
      subtitle: 'Present vs absent in recent shifts',
      tone: absentCount > 8 ? 'warning' : 'positive'
    },
    {
      id: 'open-hr-requests',
      title: 'Open HR Requests',
      value: String(openShiftRequests),
      subtitle: 'Pending shift-change approvals',
      tone: openShiftRequests > 10 ? 'warning' : 'neutral'
    },
    {
      id: 'finance-reports',
      title: 'Recent Finance Reports',
      value: String(financeReportCount),
      subtitle: 'Most recently uploaded reports',
      tone: 'neutral'
    },
    {
      id: 'inventory-sessions',
      title: 'Inventory Sessions',
      value: String(inventorySessions.length),
      subtitle: 'Latest inventory cycle updates',
      tone: 'neutral'
    },
    {
      id: 'marketing-events',
      title: 'Upcoming Marketing Events',
      value: String(upcomingMarketingEvents.length),
      subtitle: 'Scheduled events ahead',
      tone: 'neutral'
    },
    {
      id: 'cfa-logs',
      title: 'Recent CFA Logs',
      value: String(cfaLogs.length),
      subtitle: 'Latest Chick-fil-A shift logs',
      tone: 'neutral'
    },
    {
      id: 'calendar-upcoming',
      title: 'Upcoming Calendar Items',
      value: String(upcomingCalendarEvents.length),
      subtitle: 'Cross-department deadlines/events',
      tone: 'neutral'
    }
  ];

  const feed: ExecutiveFeedItem[] = [
    ...recentProductOrders.slice(0, 3).map((order) => ({
      id: `feed-order-${order.id}`,
      department: 'Product',
      title: `Order ${order.order_number ?? order.id.slice(0, 8)} updated`,
      detail: `Status: ${order.status}. Requested pickup: ${formatDate(order.requested_pickup_date)}`,
      timestamp: formatDateTime(order.created_at),
      severity: orderSeverity(order.status),
      href: '/product'
    })),
    ...financeHeaders.slice(0, 2).map((report) => ({
      id: `feed-finance-${report.id}`,
      department: 'Finance',
      title: report.report_name,
      detail: `Status: ${report.status}. Collected: ${report.total_collected ?? 0}`,
      timestamp: formatDateTime(report.uploaded_at),
      severity: financeSeverity(report.status),
      href: '/finance'
    })),
    ...upcomingMarketingEvents.slice(0, 2).map((event) => ({
      id: `feed-marketing-${event.id}`,
      department: 'Marketing',
      title: event.title,
      detail: `Status: ${event.status}. Starts: ${formatDateTime(event.starts_at)}`,
      timestamp: formatDateTime(event.updated_at),
      severity: 'info' as const,
      href: '/marketing'
    })),
    ...inventorySessions.slice(0, 2).map((session) => ({
      id: `feed-inventory-${session.id}`,
      department: 'Inventory',
      title: session.session_name,
      detail: `Session status: ${session.status}`,
      timestamp: formatDateTime(session.updated_at),
      severity: inventorySeverity(session.status),
      href: '/inventory'
    }))
  ].slice(0, 12);

  const alerts: ExecutiveAlert[] = [
    {
      id: 'alert-hr-attendance',
      title: 'Attendance Risk',
      department: 'HR',
      severity: absentCount > 8 ? 'high' : 'medium',
      description: `Recent shift absences recorded: ${absentCount}.`,
      action: 'Review shift attendance and no-show patterns in HR.'
    },
    {
      id: 'alert-product-orders',
      title: 'Open Product Orders',
      department: 'Product',
      severity: highRiskOrders > 6 ? 'high' : 'medium',
      description: `${highRiskOrders} orders are not fully received yet.`,
      action: 'Check high-priority purchase orders and expected arrival dates.'
    },
    {
      id: 'alert-finance',
      title: 'Finance Validation Watch',
      department: 'Finance',
      severity: financeHeaders.some((entry) => entry.status === 'failed_validation') ? 'high' : 'medium',
      description: 'At least one recent report may require validation follow-up.',
      action: 'Open finance reports and resolve validation issues.'
    }
  ];

  const metrics: ExecutiveMetric[] = [
    {
      id: 'metric-attendance',
      title: 'Attendance reliability',
      value: attendanceRate,
      trend: absentCount > 8 ? 'Watch closely' : 'Stable'
    },
    {
      id: 'metric-orders',
      title: 'Order pipeline',
      value: `${recentProductOrders.length} recent orders`,
      trend: highRiskOrders > 6 ? 'Backlog risk' : 'In expected range'
    },
    {
      id: 'metric-finance',
      title: 'Finance throughput',
      value: `${financeReportCount} recent report uploads`,
      trend: financeReportCount > 0 ? 'Active' : 'No recent uploads'
    },
    {
      id: 'metric-calendar',
      title: 'Calendar load',
      value: `${upcomingCalendarEvents.length} upcoming events`,
      trend: upcomingCalendarEvents.length > 8 ? 'Potential schedule conflicts' : 'Normal load'
    }
  ];

  const reports: ExecutiveReportItem[] = [
    ...financeHeaders.slice(0, 4).map((report) => ({
      id: `report-finance-${report.id}`,
      type: 'Finance',
      title: report.report_name,
      status: report.status,
      updatedAt: formatDateTime(report.uploaded_at),
      owner: report.uploaded_by ?? 'open_access',
      href: '/finance'
    })),
    ...upcomingMarketingEvents.slice(0, 2).map((event) => ({
      id: `report-marketing-${event.id}`,
      type: 'Marketing',
      title: `Event brief: ${event.title}`,
      status: event.status,
      updatedAt: formatDateTime(event.updated_at),
      owner: 'marketing',
      href: '/marketing'
    }))
  ];

  const departmentHealth: DepartmentHealthItem[] = [
    {
      id: 'health-hr',
      department: 'HR',
      status: absentCount > 8 ? 'risk' : 'watch',
      summary: `Absences this week: ${absentCount}. Pending requests: ${openShiftRequests}.`
    },
    {
      id: 'health-product',
      department: 'Product',
      status: highRiskOrders > 6 ? 'risk' : 'watch',
      summary: `${recentProductOrders.length} recent orders, ${highRiskOrders} still open.`
    },
    {
      id: 'health-finance',
      department: 'Finance',
      status: financeHeaders.some((entry) => entry.status === 'failed_validation') ? 'watch' : 'healthy',
      summary: `${financeReportCount} recent report headers ingested.`
    },
    {
      id: 'health-marketing',
      department: 'Marketing',
      status: upcomingMarketingEvents.length === 0 ? 'watch' : 'healthy',
      summary: `${upcomingMarketingEvents.length} upcoming events in calendar.`
    },
    {
      id: 'health-inventory',
      department: 'Inventory',
      status: inventorySessions.some((entry) => entry.status === 'active') ? 'watch' : 'healthy',
      summary: `${inventorySessions.length} latest session records tracked.`
    },
    {
      id: 'health-cfa',
      department: 'Chick-fil-A',
      status: cfaLogs.length > 0 ? 'healthy' : 'watch',
      summary: `${cfaLogs.length} recent CFA shift logs found.`
    }
  ];

  const executiveBrief = `Since the last 7 days, ${newOrdersThisWeek} new product orders were placed and ${openShiftRequests} HR shift requests remain pending. Attendance reliability is currently ${attendanceRate}. Finance has ${financeReportCount} recent uploaded reports, while marketing has ${upcomingMarketingEvents.length} upcoming events and inventory has ${inventorySessions.length} active/recent session records.`;

  return {
    generatedAt: nowIso,
    executiveBrief,
    summaryCards,
    feed,
    alerts,
    metrics,
    reports,
    departmentHealth
  };
}

function summarizeToolResult(toolId: string, overview: ExecutiveOverviewData): string {
  switch (toolId) {
    case 'get_executive_overview':
      return overview.executiveBrief;
    case 'get_department_updates':
      return `Top feed updates loaded: ${overview.feed.slice(0, 5).map((item) => `${item.department}: ${item.title}`).join('; ')}`;
    case 'get_hr_insights': {
      const hrHealth = overview.departmentHealth.find((row) => row.department === 'HR');
      return hrHealth?.summary ?? 'No HR summary available.';
    }
    case 'get_product_order_updates': {
      const productHealth = overview.departmentHealth.find((row) => row.department === 'Product');
      return productHealth?.summary ?? 'No product order summary available.';
    }
    case 'get_finance_report_summary': {
      const financeHealth = overview.departmentHealth.find((row) => row.department === 'Finance');
      return financeHealth?.summary ?? 'No finance summary available.';
    }
    case 'get_inventory_alerts': {
      const inventoryHealth = overview.departmentHealth.find((row) => row.department === 'Inventory');
      return inventoryHealth?.summary ?? 'No inventory summary available.';
    }
    case 'get_marketing_events_summary': {
      const marketingHealth = overview.departmentHealth.find((row) => row.department === 'Marketing');
      return marketingHealth?.summary ?? 'No marketing summary available.';
    }
    case 'get_cfa_shift_summary': {
      const cfaHealth = overview.departmentHealth.find((row) => row.department === 'Chick-fil-A');
      return cfaHealth?.summary ?? 'No CFA summary available.';
    }
    case 'get_calendar_conflicts': {
      const calendarCard = overview.summaryCards.find((card) => card.id === 'calendar-upcoming');
      return calendarCard ? `${calendarCard.value} calendar items are upcoming.` : 'No calendar summary available.';
    }
    default:
      return 'Tool completed.';
  }
}

export async function runExecutiveTooling(prompt: string): Promise<{
  toolTrace: ExecutiveToolTraceItem[];
  toolContext: string;
  overview: ExecutiveOverviewData;
}> {
  const selectedTools = planExecutiveTools(prompt).filter(
    (tool) => tool.id !== 'get_user_preferences' && tool.id !== 'sync_user_memory'
  );
  const overview = await fetchExecutiveOverview();
  const toolTrace: ExecutiveToolTraceItem[] = [];
  const contextLines: string[] = [];

  for (const tool of selectedTools) {
    const startedAt = new Date().toISOString();
    try {
      const detail = summarizeToolResult(tool.id, overview);
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: tool.id,
        label: getToolSpecById(tool.id)?.label ?? tool.id,
        status: 'complete',
        startedAt,
        finishedAt,
        detail
      });
      contextLines.push(`${tool.id}: ${detail}`);
    } catch (error) {
      const finishedAt = new Date().toISOString();
      toolTrace.push({
        id: tool.id,
        label: getToolSpecById(tool.id)?.label ?? tool.id,
        status: 'failed',
        startedAt,
        finishedAt,
        detail: error instanceof Error ? error.message : 'Tool execution failed.'
      });
    }
  }

  return {
    toolTrace,
    toolContext: contextLines.join('\n'),
    overview
  };
}
