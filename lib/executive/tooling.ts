export type ExecutiveToolStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ExecutiveToolSpec {
  id: string;
  label: string;
  runningText: string;
}

export const EXECUTIVE_TOOL_SPECS: ExecutiveToolSpec[] = [
  {
    id: 'get_executive_overview',
    label: 'Executive Overview',
    runningText: 'Building cross-department executive overview...'
  },
  {
    id: 'get_department_updates',
    label: 'Department Updates',
    runningText: 'Collecting department-by-department updates...'
  },
  {
    id: 'get_hr_insights',
    label: 'HR Insights',
    runningText: 'Fetching HR info and parsing attendance trends...'
  },
  {
    id: 'get_product_order_updates',
    label: 'Product Orders',
    runningText: 'Checking new product orders and order statuses...'
  },
  {
    id: 'get_finance_report_summary',
    label: 'Finance Reports',
    runningText: 'Reading finance report metadata and totals...'
  },
  {
    id: 'get_inventory_alerts',
    label: 'Inventory Alerts',
    runningText: 'Reviewing inventory discrepancies and session results...'
  },
  {
    id: 'get_marketing_events_summary',
    label: 'Marketing Events',
    runningText: 'Loading recent and upcoming marketing events...'
  },
  {
    id: 'get_cfa_shift_summary',
    label: 'CFA Shift Summary',
    runningText: 'Summarizing recent Chick-fil-A shift results...'
  },
  {
    id: 'get_calendar_conflicts',
    label: 'Calendar Conflicts',
    runningText: 'Checking cross-department calendar conflicts...'
  }
];

function includesAny(normalizedPrompt: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedPrompt.includes(keyword));
}

export function planExecutiveTools(prompt: string): ExecutiveToolSpec[] {
  const normalized = prompt.toLowerCase();
  const planned = new Set<string>(['get_executive_overview', 'get_department_updates']);

  if (includesAny(normalized, ['hr', 'attendance', 'employee', 'strike', 'shift'])) {
    planned.add('get_hr_insights');
  }
  if (includesAny(normalized, ['order', 'product', 'vendor', 'pickup'])) {
    planned.add('get_product_order_updates');
  }
  if (includesAny(normalized, ['finance', 'sales', 'revenue', 'fees', 'payout'])) {
    planned.add('get_finance_report_summary');
  }
  if (includesAny(normalized, ['inventory', 'stock', 'count', 'reconcile'])) {
    planned.add('get_inventory_alerts');
  }
  if (includesAny(normalized, ['marketing', 'event', 'campaign'])) {
    planned.add('get_marketing_events_summary');
  }
  if (includesAny(normalized, ['cfa', 'chick', 'menu'])) {
    planned.add('get_cfa_shift_summary');
  }
  if (includesAny(normalized, ['calendar', 'conflict', 'schedule'])) {
    planned.add('get_calendar_conflicts');
  }

  return EXECUTIVE_TOOL_SPECS.filter((tool) => planned.has(tool.id));
}

export function getToolSpecById(id: string): ExecutiveToolSpec | undefined {
  return EXECUTIVE_TOOL_SPECS.find((tool) => tool.id === id);
}
