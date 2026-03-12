export type AccessMode = 'none' | 'view' | 'edit';

export type DepartmentKey =
  | 'executive'
  | 'hr'
  | 'cfa'
  | 'finance'
  | 'marketing'
  | 'product'
  | 'inventory'
  | 'employee';

export type FeatureCapability = {
  featureKey: string;
  department: DepartmentKey;
  label: string;
  viewPermission?: string;
  editPermission?: string;
  viewBehavior: 'operational' | 'readonly';
};

export const DEPARTMENT_OPTIONS: Array<{ key: DepartmentKey; label: string }> = [
  { key: 'executive', label: 'Executive' },
  { key: 'hr', label: 'HR' },
  { key: 'cfa', label: 'CFA' },
  { key: 'finance', label: 'Finance' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'product', label: 'Product' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'employee', label: 'Employee' }
];

export const FEATURE_CAPABILITIES: FeatureCapability[] = [
  { featureKey: 'executive_ai_agent', department: 'executive', label: 'AI Agent', viewPermission: 'executive.ai_agent.view', editPermission: 'executive.ai_agent.edit', viewBehavior: 'operational' },
  { featureKey: 'executive_overview', department: 'executive', label: 'Overview', viewPermission: 'executive.overview.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_feed', department: 'executive', label: 'Department Feed', viewPermission: 'executive.department_feed.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_alerts', department: 'executive', label: 'Alerts', viewPermission: 'executive.alerts.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_metrics', department: 'executive', label: 'Metrics', viewPermission: 'executive.metrics.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_reports', department: 'executive', label: 'Reports', viewPermission: 'executive.reports.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_calendar', department: 'executive', label: 'Calendar', viewPermission: 'executive.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'executive_access', department: 'executive', label: 'Access Control', viewPermission: 'executive.access_control.view', editPermission: 'executive.access_control.edit', viewBehavior: 'readonly' },
  { featureKey: 'hr_schedule', department: 'hr', label: 'Schedule', viewPermission: 'hr.schedule.view', editPermission: 'hr.schedule.edit', viewBehavior: 'readonly' },
  { featureKey: 'hr_attendance', department: 'hr', label: 'Attendance', viewPermission: 'hr.attendance.view', editPermission: 'hr.attendance.override', viewBehavior: 'operational' },
  { featureKey: 'hr_requests', department: 'hr', label: 'Requests', viewPermission: 'hr.requests.view', editPermission: 'hr.requests.edit', viewBehavior: 'operational' },
  { featureKey: 'hr_settings', department: 'hr', label: 'Settings', editPermission: 'hr.settings.edit', viewBehavior: 'readonly' },
  { featureKey: 'hr_strikes', department: 'hr', label: 'Strikes', editPermission: 'hr.strikes.manage', viewBehavior: 'readonly' },
  { featureKey: 'hr_calendar', department: 'hr', label: 'Calendar', viewPermission: 'hr.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'cfa_logs', department: 'cfa', label: 'Logs', viewPermission: 'cfa.logs.read', editPermission: 'cfa.logs.write', viewBehavior: 'operational' },
  { featureKey: 'cfa_menu', department: 'cfa', label: 'Menu', editPermission: 'cfa.menu.manage', viewBehavior: 'readonly' },
  { featureKey: 'cfa_day_type', department: 'cfa', label: 'Day Type Override', editPermission: 'cfa.day_type.override', viewBehavior: 'readonly' },
  { featureKey: 'cfa_exports', department: 'cfa', label: 'Exports', editPermission: 'cfa.exports', viewBehavior: 'readonly' },
  { featureKey: 'finance_upload', department: 'finance', label: 'Upload', viewPermission: 'finance.upload.view', editPermission: 'finance.upload.edit', viewBehavior: 'operational' },
  { featureKey: 'finance_reports', department: 'finance', label: 'Reports', viewPermission: 'finance.reports.view', editPermission: 'finance.reports.edit', viewBehavior: 'operational' },
  { featureKey: 'finance_calendar', department: 'finance', label: 'Calendar', viewPermission: 'finance.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'marketing_events', department: 'marketing', label: 'Events', viewPermission: 'marketing.events.view', editPermission: 'marketing.events.edit', viewBehavior: 'operational' },
  { featureKey: 'marketing_contacts', department: 'marketing', label: 'Contacts', viewPermission: 'marketing.contacts.view', editPermission: 'marketing.contacts.edit', viewBehavior: 'operational' },
  { featureKey: 'marketing_coordinators', department: 'marketing', label: 'Coordinators', viewPermission: 'marketing.coordinators.view', editPermission: 'marketing.coordinators.edit', viewBehavior: 'operational' },
  { featureKey: 'marketing_reports', department: 'marketing', label: 'Reports', viewPermission: 'marketing.reports.view', editPermission: 'marketing.reports.edit', viewBehavior: 'operational' },
  { featureKey: 'marketing_settings', department: 'marketing', label: 'Settings', viewPermission: 'marketing.settings.view', editPermission: 'marketing.settings.edit', viewBehavior: 'readonly' },
  { featureKey: 'marketing_calendar', department: 'marketing', label: 'Calendars', viewPermission: 'marketing.calendar.view', editPermission: 'marketing.shared_calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'product_orders', department: 'product', label: 'Orders', viewPermission: 'product.orders.view', editPermission: 'product.orders.edit', viewBehavior: 'operational' },
  { featureKey: 'product_prompts', department: 'product', label: 'Prompts', viewPermission: 'product.prompts.view', editPermission: 'product.prompts.edit', viewBehavior: 'operational' },
  { featureKey: 'product_products', department: 'product', label: 'Products', viewPermission: 'product.products.view', editPermission: 'product.products.edit', viewBehavior: 'operational' },
  { featureKey: 'product_vendors', department: 'product', label: 'Vendors', viewPermission: 'product.vendors.view', editPermission: 'product.vendors.edit', viewBehavior: 'operational' },
  { featureKey: 'product_designs', department: 'product', label: 'Designs', viewPermission: 'product.designs.view', editPermission: 'product.designs.edit', viewBehavior: 'operational' },
  { featureKey: 'product_wishlist', department: 'product', label: 'Wishlist', viewPermission: 'product.wishlist.view', editPermission: 'product.wishlist.edit', viewBehavior: 'operational' },
  { featureKey: 'product_settings', department: 'product', label: 'Settings', viewPermission: 'product.settings.view', editPermission: 'product.settings.edit', viewBehavior: 'readonly' },
  { featureKey: 'product_calendar', department: 'product', label: 'Calendar', viewPermission: 'product.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'inventory_catalog', department: 'inventory', label: 'Catalog', viewPermission: 'inventory.catalog.view', editPermission: 'inventory.catalog.edit', viewBehavior: 'operational' },
  { featureKey: 'inventory_sessions', department: 'inventory', label: 'Sessions', viewPermission: 'inventory.sessions.view', editPermission: 'inventory.sessions.edit', viewBehavior: 'operational' },
  { featureKey: 'inventory_count', department: 'inventory', label: 'Count View', viewPermission: 'inventory.count_view.view', editPermission: 'inventory.count_view.edit', viewBehavior: 'operational' },
  { featureKey: 'inventory_finalize', department: 'inventory', label: 'Finalize & Upload', viewPermission: 'inventory.finalize_upload.view', editPermission: 'inventory.finalize_upload.edit', viewBehavior: 'readonly' },
  { featureKey: 'inventory_calendar', department: 'inventory', label: 'Calendar', viewPermission: 'inventory.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'employee_calendar', department: 'employee', label: 'Calendar', viewPermission: 'employee.calendar.view', viewBehavior: 'readonly' },
  { featureKey: 'employee_schedule', department: 'employee', label: 'Schedule', viewPermission: 'employee.schedule.view', viewBehavior: 'readonly' },
  { featureKey: 'employee_accountability', department: 'employee', label: 'Accountability', viewPermission: 'employee.accountability.view', viewBehavior: 'readonly' },
  { featureKey: 'employee_requests', department: 'employee', label: 'Requests', viewPermission: 'employee.requests.view', editPermission: 'employee.requests.edit', viewBehavior: 'operational' }
];

export function modeFromPermissions(
  capability: FeatureCapability,
  permissions: string[]
): AccessMode {
  const hasView = capability.viewPermission ? permissions.includes(capability.viewPermission) : false;
  const hasEdit = capability.editPermission ? permissions.includes(capability.editPermission) : false;
  if (hasEdit) return 'edit';
  if (hasView) return 'view';
  return 'none';
}

export function featureModesFromPermissions(
  permissions: string[]
): Record<string, AccessMode> {
  const next: Record<string, AccessMode> = {};
  for (const capability of FEATURE_CAPABILITIES) {
    next[capability.featureKey] = modeFromPermissions(capability, permissions);
  }
  return next;
}

export function featureModesFromPermissionsAndOverrides(input: {
  permissions: string[];
  overrides: Array<{ permission_key: string; effect: 'allow' | 'deny' }>;
}): Record<string, AccessMode> {
  const next = featureModesFromPermissions(input.permissions);
  const overrideByPermission = new Map<string, 'allow' | 'deny'>();
  for (const override of input.overrides) {
    if (!override?.permission_key) continue;
    overrideByPermission.set(
      override.permission_key,
      override.effect === 'deny' ? 'deny' : 'allow'
    );
  }

  for (const capability of FEATURE_CAPABILITIES) {
    const viewOverride = capability.viewPermission
      ? overrideByPermission.get(capability.viewPermission)
      : undefined;
    const editOverride = capability.editPermission
      ? overrideByPermission.get(capability.editPermission)
      : undefined;

    if (editOverride === 'allow') {
      next[capability.featureKey] = 'edit';
      continue;
    }
    if (viewOverride === 'allow') {
      next[capability.featureKey] = 'view';
      continue;
    }
    if (viewOverride === 'deny' || editOverride === 'deny') {
      next[capability.featureKey] = 'none';
    }
  }

  return next;
}
