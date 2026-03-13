import { EXECUTIVE_TOOL_SPECS } from '@/lib/executive/tooling';
import { ToolCatalogEntry } from '@/lib/executive/tool-query';

const ALL_PUBLIC_TABLES = [
  'access_permissions',
  'access_role_permissions',
  'access_role_templates',
  'access_roles',
  'attendance',
  'attendance_overrides',
  'audit_log',
  'auth_sessions',
  'cfa_daily_log_lines',
  'cfa_daily_logs',
  'cfa_items',
  'coordination_logs',
  'employee_login_credentials',
  'employee_permission_overrides',
  'employee_role_assignments',
  'employee_settings',
  'event_assets',
  'event_contacts',
  'event_notes',
  'executive_agent_memory_facts',
  'executive_agent_messages',
  'external_contacts',
  'finance_report_activity_log',
  'finance_report_config',
  'finance_report_headers',
  'finance_report_issues',
  'finance_report_rows',
  'general_department_calendar_events',
  'hr_attendance_overrides',
  'hr_audit_log',
  'hr_auth_credentials',
  'hr_employee_login_credentials',
  'hr_employee_settings',
  'hr_meeting_attendance_records',
  'hr_morning_shift_attendance',
  'hr_off_period_shift_attendance',
  'hr_points_ledger',
  'hr_schedules',
  'hr_shift_attendance',
  'hr_shift_change_requests',
  'hr_strike_appeals',
  'hr_strikes',
  'hr_user_roles',
  'internal_coordinators',
  'Inventory',
  'inventory_check_audit_log',
  'inventory_check_change_requests',
  'inventory_check_signups',
  'inventory_checks',
  'inventory_manual_overrides',
  'inventory_session_events',
  'inventory_session_final',
  'inventory_session_participants',
  'inventory_session_snapshots',
  'inventory_sessions',
  'inventory_upload_runs',
  'marketing_event_categories',
  'marketing_events',
  'marketing_reports',
  'meeting_attendance_records',
  'morning_shift_attendance',
  'off_period_shift_attendance',
  'points_ledger',
  'product_attachments',
  'product_audit_log',
  'product_categories',
  'product_designs',
  'product_inventory_levels',
  'product_inventory_snapshot_lines',
  'product_inventory_uploads',
  'product_order_prompts',
  'product_products',
  'product_purchase_order_attachments',
  'product_purchase_order_line_attachments',
  'product_purchase_order_lines',
  'product_purchase_orders',
  'product_receipt_lines',
  'product_receipts',
  'product_settings',
  'product_vendors',
  'product_wishlist_items',
  'schedules',
  'shift_attendance',
  'shift_change_requests',
  'strike_appeals',
  'strikes',
  'students',
  'user_roles'
] as const;

function tableDepartment(table: string): string {
  if (table.startsWith('hr_') || ['students', 'attendance', 'meeting_attendance_records', 'shift_attendance', 'shift_change_requests', 'strikes', 'strike_appeals', 'points_ledger', 'employee_settings', 'employee_login_credentials'].includes(table)) {
    return 'hr';
  }
  if (table.startsWith('product_')) return 'product';
  if (table.startsWith('finance_')) return 'finance';
  if (table.startsWith('marketing_') || table.startsWith('event_') || ['external_contacts', 'internal_coordinators', 'coordination_logs'].includes(table)) {
    return 'marketing';
  }
  if (table.startsWith('inventory_') || table.startsWith('cfa_') || table === 'Inventory') return 'inventory';
  if (table === 'general_department_calendar_events') return 'calendar';
  if (table.startsWith('access_') || ['auth_sessions', 'employee_role_assignments', 'employee_permission_overrides'].includes(table)) {
    return 'access';
  }
  if (table.startsWith('executive_agent_')) return 'executive';
  return 'shared';
}

export function buildExecutiveToolCatalog(): ToolCatalogEntry[] {
  const departmentPacks: ToolCatalogEntry[] = EXECUTIVE_TOOL_SPECS.filter((tool) =>
    tool.id.endsWith('_deep_dive') || tool.id === 'executive_overview'
  ).map((tool) => ({
    id: tool.id,
    label: tool.label,
    kind: 'department_pack',
    department: tool.id.replace('_deep_dive', ''),
    capabilityTags: ['summary', 'cross_department']
  }));

  const tableTools: ToolCatalogEntry[] = ALL_PUBLIC_TABLES.map((table) => ({
    id: `table_${table.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
    label: table,
    kind: 'table_tool',
    department: tableDepartment(table),
    capabilityTags: ['table_query', 'read_only', 'row_level'],
    table
  }));

  const discoveryTools: ToolCatalogEntry[] = [
    { id: 'schema_map', label: 'Schema Map', kind: 'discovery_tool', department: 'shared', capabilityTags: ['schema'] },
    { id: 'describe_table', label: 'Describe Table', kind: 'discovery_tool', department: 'shared', capabilityTags: ['schema'] },
    { id: 'query_table', label: 'Query Table', kind: 'discovery_tool', department: 'shared', capabilityTags: ['query'] },
    { id: 'query_related', label: 'Query Related', kind: 'discovery_tool', department: 'shared', capabilityTags: ['relations'] },
    { id: 'storage_metadata', label: 'Storage Metadata', kind: 'discovery_tool', department: 'shared', capabilityTags: ['storage'] }
  ];

  return [...departmentPacks, ...tableTools, ...discoveryTools];
}
