import { parsePromptExplicitDateRange, ToolDateRange } from '@/lib/executive/tool-query';

export type ExecutiveToolStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ExecutiveToolSpec {
  id: string;
  label: string;
  purpose: string;
  runningText: string;
}

export type ExecutiveDataPack =
  | 'executive_overview'
  | 'hr_deep_dive'
  | 'product_ops_deep_dive'
  | 'marketing_deep_dive'
  | 'finance_deep_dive'
  | 'inventory_deep_dive'
  | 'cfa_deep_dive'
  | 'calendar_deep_dive'
  | 'access_deep_dive';

export type ShiftScope = 'morning' | 'off_period' | 'any' | 'none';

export const EXECUTIVE_TOOL_SPECS: ExecutiveToolSpec[] = [
  {
    id: 'get_user_preferences',
    label: 'User Preferences',
    purpose: 'Load durable user preferences and critical context from Supabase memory.',
    runningText: 'Loading saved preferences and durable memory facts...'
  },
  {
    id: 'executive_overview',
    label: 'Executive Overview',
    purpose: 'Cross-department baseline summary with canonical date-window context.',
    runningText: 'Loading cross-department executive overview...'
  },
  {
    id: 'hr_deep_dive',
    label: 'HR Deep Dive',
    purpose: 'Minute-level HR data including mirrors, attendance, meetings, requests, strikes, and appeals.',
    runningText: 'Collecting HR mirror + canonical detail...'
  },
  {
    id: 'product_ops_deep_dive',
    label: 'Product Deep Dive',
    purpose: 'Detailed product operations data including orders, lines, receipts, prompts, attachments, and wishlist.',
    runningText: 'Collecting detailed product operations data...'
  },
  {
    id: 'marketing_deep_dive',
    label: 'Marketing Deep Dive',
    purpose: 'Detailed marketing events, contacts, assets, notes, coordination, and reports.',
    runningText: 'Collecting detailed marketing event and reporting data...'
  },
  {
    id: 'finance_deep_dive',
    label: 'Finance Deep Dive',
    purpose: 'Detailed finance report headers, rows, issues, config, activity, and metadata.',
    runningText: 'Collecting detailed finance reporting data...'
  },
  {
    id: 'inventory_deep_dive',
    label: 'Inventory Deep Dive',
    purpose: 'Inventory sessions/checks/signups/events/manual overrides and upload lineage.',
    runningText: 'Collecting detailed inventory data...'
  },
  {
    id: 'cfa_deep_dive',
    label: 'CFA Deep Dive',
    purpose: 'CFA daily logs, line items, and operational trend context.',
    runningText: 'Collecting detailed CFA operational data...'
  },
  {
    id: 'calendar_deep_dive',
    label: 'Calendar Deep Dive',
    purpose: 'Cross-department calendar coverage and conflict context.',
    runningText: 'Collecting detailed calendar data...'
  },
  {
    id: 'access_deep_dive',
    label: 'Access Deep Dive',
    purpose: 'Access/RBAC roles, permissions, assignments, and session context.',
    runningText: 'Collecting detailed access control data...'
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
    'shift',
    'schedule',
    'scheduled',
    'tomorrow'
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
    'schedule',
    'scheduled',
    'working',
    'work',
    'who is working',
    'roster',
    'tomorrow',
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
    'metric',
    'permission',
    'role',
    'access'
  ]);
}

export function isToolListingPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes('list tools') ||
    normalized.includes('all tools') ||
    normalized.includes('what tools') ||
    normalized.includes('tool manifest') ||
    normalized.includes('each tool')
  );
}

export function isAttendancePrecisionPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const asksAttendance = includesAny(normalized, [
    'attendance',
    'morning meeting',
    'morning shift',
    'off period shift',
    'off-period shift',
    'shift attendance',
    'meeting attendance'
  ]);
  if (!asksAttendance) return false;
  return includesAny(normalized, [
    'who',
    'below',
    'between',
    'trend',
    'patterns',
    'pattern',
    'most',
    'least',
    'consistently',
    'over the last',
    'last',
    'past',
    '100%',
    '75%',
    '50%'
  ]);
}

export function detectShiftScope(prompt: string): ShiftScope {
  const normalized = prompt.toLowerCase();
  const hasShiftLanguage = includesAny(normalized, ['shift', 'attendance']);
  if (!hasShiftLanguage) return 'none';

  if (
    includesAny(normalized, [
      'off period',
      'off-period',
      'off period shift',
      'off-period shift',
      'off period attendance',
      'off-period attendance'
    ])
  ) {
    return 'off_period';
  }

  if (includesAny(normalized, ['morning shift', 'morning attendance', 'period 0', 'p0'])) {
    return 'morning';
  }

  return 'any';
}

export function planExecutiveDataPacks(prompt: string): ExecutiveDataPack[] {
  const normalized = prompt.toLowerCase();
  if (isGreetingPrompt(normalized)) return [];

  const wantsCrossDepartmentView = includesAny(normalized, [
    'all departments',
    'across departments',
    'cross-department',
    'executive overview',
    'overall',
    'company-wide',
    'everything'
  ]);

  const needsHr = includesAny(normalized, [
    'hr',
    'attendance',
    'meeting',
    'employee',
    'strike',
    'shift',
    'request',
    'appeal'
  ]);
  const needsProduct = includesAny(normalized, ['order', 'product', 'vendor', 'pickup', 'wishlist', 'receipt']);
  const needsFinance = includesAny(normalized, ['finance', 'sales', 'revenue', 'fees', 'payout', 'report']);
  const needsInventory = includesAny(normalized, ['inventory', 'stock', 'count', 'reconcile']);
  const needsMarketing = includesAny(normalized, ['marketing', 'event', 'campaign', 'contact', 'coordination']);
  const needsCfa = includesAny(normalized, ['cfa', 'chick', 'menu']);
  const needsCalendar = includesAny(normalized, ['calendar', 'conflict']);
  const needsAccess = includesAny(normalized, ['access', 'permission', 'role', 'rbac', 'auth']);

  const planned = new Set<ExecutiveDataPack>();
  if (wantsCrossDepartmentView || ![needsHr, needsProduct, needsFinance, needsInventory, needsMarketing, needsCfa, needsCalendar, needsAccess].some(Boolean)) {
    planned.add('executive_overview');
  }
  if (needsHr) planned.add('hr_deep_dive');
  if (needsProduct) planned.add('product_ops_deep_dive');
  if (needsFinance) planned.add('finance_deep_dive');
  if (needsInventory) planned.add('inventory_deep_dive');
  if (needsMarketing) planned.add('marketing_deep_dive');
  if (needsCfa) planned.add('cfa_deep_dive');
  if (needsCalendar) planned.add('calendar_deep_dive');
  if (needsAccess) planned.add('access_deep_dive');

  return Array.from(planned);
}

export function resolveExecutiveDateRange(prompt: string, pack: ExecutiveDataPack): ToolDateRange {
  const explicit = parsePromptExplicitDateRange(prompt);
  if (explicit) return explicit;

  const now = new Date();
  const from = new Date(now);
  if (pack === 'hr_deep_dive') {
    from.setDate(from.getDate() - 90);
  } else if (pack === 'calendar_deep_dive') {
    return {
      mode: 'explicit',
      from: now.toISOString(),
      to: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      column: 'starts_at'
    };
  } else {
    from.setDate(from.getDate() - 30);
  }

  return {
    mode: 'explicit',
    from: from.toISOString(),
    to: now.toISOString()
  };
}

export function planExecutiveTools(prompt: string): ExecutiveToolSpec[] {
  const packs = planExecutiveDataPacks(prompt);
  return EXECUTIVE_TOOL_SPECS.filter((tool) => packs.includes(tool.id as ExecutiveDataPack));
}

export function getToolSpecById(id: string): ExecutiveToolSpec | undefined {
  return EXECUTIVE_TOOL_SPECS.find((tool) => tool.id === id);
}
