export type ExecutiveToolStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ExecutiveToolSpec {
  id: string;
  label: string;
  purpose: string;
  runningText: string;
}

export const EXECUTIVE_TOOL_SPECS: ExecutiveToolSpec[] = [
  {
    id: 'get_user_preferences',
    label: 'User Preferences',
    purpose: 'Load durable user preferences and critical context from Supabase memory.',
    runningText: 'Loading saved preferences and durable memory facts...'
  },
  {
    id: 'get_executive_overview',
    label: 'Executive Overview',
    purpose: 'Build the latest cross-department executive snapshot from source tables.',
    runningText: 'Building fresh executive snapshot across departments...'
  },
  {
    id: 'get_department_updates',
    label: 'Department Updates',
    purpose: 'Extract the most recent important updates by department.',
    runningText: 'Collecting department-specific update feed...'
  },
  {
    id: 'get_hr_insights',
    label: 'HR Insights',
    purpose: 'Retrieve HR attendance, shift, meeting, and request insights for executive review.',
    runningText: 'Analyzing HR attendance, meetings, and request signals...'
  },
  {
    id: 'get_product_order_updates',
    label: 'Product Orders',
    purpose: 'Summarize product order intake and current fulfillment status.',
    runningText: 'Reviewing recent product order and fulfillment activity...'
  },
  {
    id: 'get_finance_report_summary',
    label: 'Finance Reports',
    purpose: 'Summarize latest finance report uploads and validation health.',
    runningText: 'Reviewing finance report uploads and validation state...'
  },
  {
    id: 'get_inventory_alerts',
    label: 'Inventory Alerts',
    purpose: 'Review inventory session outcomes and active discrepancy risk.',
    runningText: 'Checking inventory sessions and discrepancy risk signals...'
  },
  {
    id: 'get_marketing_events_summary',
    label: 'Marketing Events',
    purpose: 'Summarize upcoming marketing events and readiness signals.',
    runningText: 'Loading upcoming marketing events and status...'
  },
  {
    id: 'get_cfa_shift_summary',
    label: 'CFA Shift Summary',
    purpose: 'Summarize recent Chick-fil-A operational logs and cadence.',
    runningText: 'Summarizing recent Chick-fil-A shift logs...'
  },
  {
    id: 'get_calendar_conflicts',
    label: 'Calendar Conflicts',
    purpose: 'Identify upcoming cross-department calendar load and conflict risk.',
    runningText: 'Checking shared calendar load and conflict risk...'
  },
  {
    id: 'use_recent_context',
    label: 'Recent Context Cache',
    purpose: 'Reuse very recent executive context to avoid redundant tool calls.',
    runningText: 'Reusing recent context cache to avoid duplicate calls...'
  },
  {
    id: 'sync_user_memory',
    label: 'Memory Writer',
    purpose: 'Condense durable facts with qwen3:8b and write memory updates.',
    runningText: 'Condensing durable facts and syncing memory...'
  }
];

function includesAny(normalizedPrompt: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedPrompt.includes(keyword));
}

export function isGreetingPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  return /^(hi|hello|hey|yo|sup|what('?s| is) up|good morning|good afternoon|good evening|how are you)[!.?\s]*$/.test(
    normalized
  );
}

export function requiresFreshDataPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return includesAny(normalized, [
    'latest',
    'today',
    'right now',
    'current',
    'refresh',
    'updated',
    'just now',
    'most recent',
    'who',
    'anyone',
    'pattern',
    'consistently',
    'request',
    'requests',
    'shift'
  ]);
}

export function isOperationalDataPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  if (!normalized.trim()) return false;
  if (isGreetingPrompt(normalized)) return false;

  return includesAny(normalized, [
    'overview',
    'status',
    'update',
    'changed',
    'department',
    'hr',
    'attendance',
    'shift',
    'working',
    'who is working',
    'roster',
    'morning',
    'off period',
    'off-period',
    'employee',
    'strike',
    'order',
    'product',
    'vendor',
    'pickup',
    'finance',
    'sales',
    'revenue',
    'fees',
    'payout',
    'inventory',
    'stock',
    'count',
    'reconcile',
    'marketing',
    'event',
    'campaign',
    'calendar',
    'conflict',
    'cfa',
    'chick',
    'report',
    'metric'
  ]);
}

export function planExecutiveTools(prompt: string): ExecutiveToolSpec[] {
  const normalized = prompt.toLowerCase();
  if (isGreetingPrompt(normalized)) return [];

  const planned = new Set<string>();
  const hasOperationalIntent = isOperationalDataPrompt(normalized);

  const wantsCrossDepartmentView = includesAny(normalized, [
    'all departments',
    'across departments',
    'cross-department',
    'executive overview',
    'overall',
    'company-wide',
    'everything'
  ]);
  const wantsOverviewStyle = includesAny(normalized, [
    'overview',
    'summary',
    'snapshot',
    'status',
    'what changed'
  ]);

  const needsHr = includesAny(normalized, [
    'hr',
    'attendance',
    'meeting',
    'employee',
    'strike',
    'shift',
    'schedule',
    'roster',
    'working',
    'tomorrow',
    'request',
    'requests',
    'schedule out',
    'scheduling out',
    'morning',
    'off period',
    'off-period'
  ]);
  const needsProduct = includesAny(normalized, ['order', 'product', 'vendor', 'pickup']);
  const needsFinance = includesAny(normalized, ['finance', 'sales', 'revenue', 'fees', 'payout']);
  const needsInventory = includesAny(normalized, ['inventory', 'stock', 'count', 'reconcile']);
  const needsMarketing = includesAny(normalized, ['marketing', 'event', 'campaign']);
  const needsCfa = includesAny(normalized, ['cfa', 'chick', 'menu']);
  const needsCalendar = includesAny(normalized, ['calendar', 'conflict', 'schedule']);
  const requestedDomains = [needsHr, needsProduct, needsFinance, needsInventory, needsMarketing, needsCfa].filter(
    Boolean
  ).length;

  if (hasOperationalIntent && (wantsCrossDepartmentView || requestedDomains !== 1)) {
    planned.add('get_executive_overview');
  }
  if (hasOperationalIntent && wantsOverviewStyle && wantsCrossDepartmentView) {
    planned.add('get_department_updates');
  }

  if (needsHr) {
    planned.add('get_hr_insights');
  }
  if (needsProduct) {
    planned.add('get_product_order_updates');
  }
  if (needsFinance) {
    planned.add('get_finance_report_summary');
  }
  if (needsInventory) {
    planned.add('get_inventory_alerts');
  }
  if (needsMarketing) {
    planned.add('get_marketing_events_summary');
  }
  if (needsCfa) {
    planned.add('get_cfa_shift_summary');
  }
  if (needsCalendar) {
    planned.add('get_calendar_conflicts');
  }

  return EXECUTIVE_TOOL_SPECS.filter((tool) => planned.has(tool.id));
}

export function getToolSpecById(id: string): ExecutiveToolSpec | undefined {
  return EXECUTIVE_TOOL_SPECS.find((tool) => tool.id === id);
}
