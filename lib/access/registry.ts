import { NavSectionDefinition, PermissionDefinition, PermissionKey, RoleDefinition } from '@/lib/access/types';

function permission(
  permissionKey: PermissionKey,
  label: string,
  legacyAliases: string[] = [],
  description?: string
): PermissionDefinition {
  const [resourcePart, action, scopeRaw] = permissionKey.split(':');
  const [department, ...resourceParts] = resourcePart.split('.');
  return {
    permissionKey,
    department: department as PermissionDefinition['department'],
    resource: resourceParts.join('.'),
    action: action as PermissionDefinition['action'],
    scope: (scopeRaw as PermissionDefinition['scope']) ?? null,
    label,
    description,
    legacyAliases
  };
}

export const PERMISSIONS: PermissionDefinition[] = [
  permission('executive.ai:view:own', 'Executive AI Agent View', ['executive.ai_agent.view']),
  permission('executive.ai:view:all', 'Executive AI Agent View All'),
  permission('executive.ai:manage:all', 'Executive AI Agent Manage', ['executive.ai_agent.edit']),
  permission('executive.overview:view:all', 'Executive Overview View', ['executive.overview.view']),
  permission('executive.feed:view:all', 'Executive Feed View', ['executive.department_feed.view']),
  permission('executive.alerts:view:all', 'Executive Alerts View', ['executive.alerts.view']),
  permission('executive.metrics:view:all', 'Executive Metrics View', ['executive.metrics.view']),
  permission('executive.reports:view:all', 'Executive Reports View', ['executive.reports.view']),
  permission('executive.calendar:view:all', 'Executive Calendar View', ['executive.calendar.view']),
  permission('executive.access:view:all', 'Access Control View', ['executive.access_control.view']),
  permission('executive.access:manage:all', 'Access Control Manage', ['executive.access_control.edit']),
  permission('executive.audit:view:all', 'Executive Audit View', ['hr.audit.view']),
  permission('executive.audit:export:all', 'Executive Audit Export'),
  permission('executive.hours:view:all', 'Executive Hours View', ['executive.hours.view']),
  permission('executive.hours:approve:all', 'Executive Hours Approve', ['executive.hours.approve']),

  permission('hr.schedule:view:own', 'HR Schedule View Own', ['hr.schedule.view', 'employee.schedule.view']),
  permission('hr.schedule:view:all', 'HR Schedule View All'),
  permission('hr.schedule:edit:all', 'HR Schedule Edit All', ['hr.schedule.edit']),
  permission('hr.schedule:approve:all', 'HR Schedule Approve All'),
  permission('hr.meeting_attendance:view:own', 'Meeting Attendance View Own', ['hr.attendance.view', 'employee.accountability.view']),
  permission('hr.meeting_attendance:view:all', 'Meeting Attendance View All'),
  permission('hr.meeting_attendance:override:all', 'Meeting Attendance Override All', ['hr.attendance.override']),
  permission('hr.shift_attendance:view:own', 'Shift Attendance View Own', ['hr.attendance.view']),
  permission('hr.shift_attendance:view:all', 'Shift Attendance View All'),
  permission('hr.shift_attendance:override:all', 'Shift Attendance Override All', ['hr.attendance.override']),
  permission('hr.requests:submit:own', 'HR Requests Submit Own', ['hr.requests.view', 'employee.requests.edit', 'employee.requests.view']),
  permission('hr.requests:approve:all', 'HR Requests Approve All', ['hr.requests.edit']),
  permission('hr.employee_records:view:own', 'Employee Records View Own'),
  permission('hr.employee_records:view:all', 'Employee Records View All'),
  permission('hr.employee_records:manage:all', 'Employee Records Manage All', ['hr.settings.edit']),
  permission('hr.settings:view:own', 'HR Settings View Own'),
  permission('hr.settings:view:all', 'HR Settings View All'),
  permission('hr.settings:manage:all', 'HR Settings Manage All', ['hr.settings.edit']),
  permission('hr.strikes:view:own', 'HR Strikes View Own'),
  permission('hr.strikes:view:all', 'HR Strikes View All'),
  permission('hr.strikes:manage:all', 'HR Strikes Manage All', ['hr.strikes.manage']),
  permission('hr.audit:view:all', 'HR Audit View', ['hr.audit.view']),
  permission('hr.audit:export:all', 'HR Audit Export'),

  permission('cfa.logs:view:all', 'CFA Logs View', ['cfa.logs.read']),
  permission('cfa.logs:write:all', 'CFA Logs Write', ['cfa.logs.write']),
  permission('cfa.history:view:all', 'CFA History View', ['cfa.logs.read']),
  permission('cfa.forecast:view:all', 'CFA Forecast View', ['cfa.logs.read']),
  permission('cfa.analytics:view:all', 'CFA Analysis View', ['cfa.logs.read']),
  permission('cfa.menu:view:all', 'CFA Menu View', ['cfa.logs.read']),
  permission('cfa.menu:manage:all', 'CFA Menu Manage', ['cfa.menu.manage']),
  permission('cfa.day_type:manage:all', 'CFA Day Type Manage', ['cfa.day_type.override']),
  permission('cfa.exports:export:all', 'CFA Export', ['cfa.exports']),

  permission('finance.upload:view:own', 'Finance Upload View Own', ['finance.upload.view']),
  permission('finance.upload:view:all', 'Finance Upload View All'),
  permission('finance.upload:upload:all', 'Finance Upload All', ['finance.upload.edit']),
  permission('finance.reports:view:all', 'Finance Reports View', ['finance.reports.view']),
  permission('finance.reports:edit:all', 'Finance Reports Edit', ['finance.reports.edit']),
  permission('finance.reports:export:all', 'Finance Reports Export'),
  permission('finance.calendar:view:all', 'Finance Calendar View', ['finance.calendar.view']),

  permission('marketing.events:view:own', 'Marketing Events View', ['marketing.events.view']),
  permission('marketing.events:view:all', 'Marketing Events View All'),
  permission('marketing.events:edit:all', 'Marketing Events Edit', ['marketing.events.edit']),
  permission('marketing.events:publish:all', 'Marketing Events Publish'),
  permission('marketing.contacts:view:all', 'Marketing Contacts View', ['marketing.contacts.view']),
  permission('marketing.contacts:edit:all', 'Marketing Contacts Edit', ['marketing.contacts.edit']),
  permission('marketing.coordinators:view:all', 'Marketing Coordinators View', ['marketing.coordinators.view']),
  permission('marketing.coordinators:edit:all', 'Marketing Coordinators Edit', ['marketing.coordinators.edit']),
  permission('marketing.reports:view:all', 'Marketing Reports View', ['marketing.reports.view']),
  permission('marketing.reports:edit:all', 'Marketing Reports Edit', ['marketing.reports.edit']),
  permission('marketing.reports:export:all', 'Marketing Reports Export'),
  permission('marketing.calendars:view:all', 'Marketing Calendars View', ['marketing.calendar.view', 'marketing.shared_calendar.view']),
  permission('marketing.calendars:manage:all', 'Marketing Calendars Manage', ['marketing.shared_calendar.view']),
  permission('marketing.settings:view:all', 'Marketing Settings View', ['marketing.settings.view']),
  permission('marketing.settings:manage:all', 'Marketing Settings Manage', ['marketing.settings.edit']),

  permission('product.orders:view:own', 'Product Orders View', ['product.orders.view']),
  permission('product.orders:view:all', 'Product Orders View All'),
  permission('product.orders:edit:all', 'Product Orders Edit', ['product.orders.edit']),
  permission('product.orders:approve:all', 'Product Orders Approve'),
  permission('product.orders:order:all', 'Product Orders Place'),
  permission('product.prompts:view:all', 'Product Prompts View', ['product.prompts.view']),
  permission('product.prompts:edit:all', 'Product Prompts Edit', ['product.prompts.edit']),
  permission('product.prompts:convert:all', 'Product Prompts Convert'),
  permission('product.products:view:all', 'Product Catalog View', ['product.products.view']),
  permission('product.products:edit:all', 'Product Catalog Edit', ['product.products.edit']),
  permission('product.vendors:view:all', 'Product Vendors View', ['product.vendors.view']),
  permission('product.vendors:edit:all', 'Product Vendors Edit', ['product.vendors.edit']),
  permission('product.designs:view:all', 'Product Designs View', ['product.designs.view']),
  permission('product.designs:edit:all', 'Product Designs Edit', ['product.designs.edit']),
  permission('product.wishlist:view:own', 'Product Wishlist View', ['product.wishlist.view']),
  permission('product.wishlist:view:all', 'Product Wishlist View All'),
  permission('product.wishlist:edit:all', 'Product Wishlist Edit', ['product.wishlist.edit']),
  permission('product.wishlist:convert:all', 'Product Wishlist Convert'),
  permission('product.settings:view:all', 'Product Settings View', ['product.settings.view']),
  permission('product.settings:manage:all', 'Product Settings Manage', ['product.settings.edit']),
  permission('product.calendar:view:all', 'Product Calendar View', ['product.calendar.view']),

  permission('inventory.catalog:view:all', 'Inventory Catalog View', ['inventory.catalog.view', 'inventory.catalog:view:own']),
  permission('inventory.catalog:edit:all', 'Inventory Catalog Edit', ['inventory.catalog.edit']),
  permission('inventory.catalog:import:all', 'Inventory Catalog Import'),
  permission('inventory.sessions:join:assigned_location', 'Inventory Session Join', ['inventory.sessions.view']),
  permission('inventory.sessions:create:all', 'Inventory Session Create', ['inventory.sessions.edit']),
  permission('inventory.sessions:edit:all', 'Inventory Session Manage', ['inventory.sessions.edit']),
  permission('inventory.counts:view:own', 'Inventory Count View', ['inventory.count_view.view']),
  permission('inventory.counts:view:all', 'Inventory Count View All'),
  permission('inventory.counts:edit:all', 'Inventory Count Edit', ['inventory.count_view.edit']),
  permission('inventory.finalize_upload:view:own', 'Inventory Finalize View', ['inventory.finalize_upload.view']),
  permission('inventory.finalize_upload:view:all', 'Inventory Finalize View All'),
  permission('inventory.finalize_upload:finalize:all', 'Inventory Finalize', ['inventory.finalize_upload.edit']),
  permission('inventory.finalize_upload:upload:all', 'Inventory Upload', ['inventory.finalize_upload.edit']),
  permission('inventory.finalize_upload:lock:all', 'Inventory Lock Session'),
  permission('inventory.calendar:view:all', 'Inventory Calendar View', ['inventory.calendar.view']),
  permission('inventory.attendance:view:all', 'Inventory Attendance View', ['inventory.attendance.view']),
  permission('inventory.attendance:edit:all', 'Inventory Attendance Edit', ['inventory.attendance.edit']),
  permission('inventory.attendance:override:all', 'Inventory Attendance Override', ['inventory.attendance.override']),
  permission(
    'inventory.attendance:requests:approve:all',
    'Inventory Attendance Request Approve',
    ['inventory.attendance.requests.approve']
  ),

  permission('employee.calendar:view:own', 'Employee Calendar View', ['employee.calendar.view']),
  permission('employee.calendar:view:all', 'Employee Calendar View All'),
  permission('employee.schedule:view:own', 'Employee Schedule View', ['employee.schedule.view']),
  permission('employee.schedule:view:all', 'Employee Schedule View All'),
  permission('employee.schedule:submit:own', 'Employee Schedule Submit Requests'),
  permission('employee.accountability:view:own', 'Employee Accountability View', ['employee.accountability.view']),
  permission('employee.accountability:view:all', 'Employee Accountability View All'),
  permission('employee.requests:submit:own', 'Employee Requests Submit', ['employee.requests.view', 'employee.requests.edit']),
  permission('employee.hours:submit:own', 'Employee Hours Submit', ['employee.hours.submit']),
  permission(
    'employee.inventory_checks:view:own',
    'Employee Inventory Checks View',
    ['employee.inventory_checks.view']
  ),
  permission('employee.inventory_checks:view:all', 'Employee Inventory Checks View All'),
  permission(
    'employee.inventory_checks:signup:own',
    'Employee Inventory Checks Signup',
    ['employee.inventory_checks.signup']
  ),
  permission(
    'employee.inventory_checks:request_change:own',
    'Employee Inventory Checks Change Request',
    ['employee.inventory_checks.request_change']
  )
];

export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((permission) => [permission.permissionKey, permission]));

export const LEGACY_TO_CANONICAL = new Map<string, PermissionKey>();
for (const permission of PERMISSIONS) {
  for (const alias of permission.legacyAliases ?? []) {
    LEGACY_TO_CANONICAL.set(alias, permission.permissionKey);
  }
}

export const CANONICAL_TO_LEGACY = new Map<PermissionKey, string[]>();
for (const permission of PERMISSIONS) {
  CANONICAL_TO_LEGACY.set(permission.permissionKey, permission.legacyAliases ?? []);
}

export const BASELINE_ROLES: RoleDefinition[] = [
  {
    roleKey: 'admin',
    roleName: 'Admin',
    description: 'Full system access.',
    isSystem: true,
    permissions: ['*' as PermissionKey]
  },
  {
    roleKey: 'executive_manager',
    roleName: 'Executive Manager',
    description: 'Executive dashboard, department overview, and access governance.',
    isSystem: true,
    permissions: [
      'executive.ai:view:own',
      'executive.ai:view:all',
      'executive.ai:manage:all',
      'executive.overview:view:all',
      'executive.feed:view:all',
      'executive.alerts:view:all',
      'executive.metrics:view:all',
      'executive.reports:view:all',
      'executive.calendar:view:all',
      'executive.access:view:all',
      'executive.access:manage:all',
      'executive.audit:view:all',
      'executive.audit:export:all',
      'executive.hours:view:all',
      'executive.hours:approve:all'
    ]
  },
  {
    roleKey: 'hr_manager',
    roleName: 'HR Manager',
    description: 'Manage HR operations and approvals.',
    isSystem: true,
    permissions: [
      'hr.schedule:view:own',
      'hr.schedule:view:all',
      'hr.schedule:edit:all',
      'hr.schedule:approve:all',
      'hr.meeting_attendance:view:own',
      'hr.meeting_attendance:view:all',
      'hr.meeting_attendance:override:all',
      'hr.shift_attendance:view:own',
      'hr.shift_attendance:view:all',
      'hr.shift_attendance:override:all',
      'hr.requests:submit:own',
      'hr.requests:approve:all',
      'hr.employee_records:view:own',
      'hr.employee_records:view:all',
      'hr.employee_records:manage:all',
      'hr.settings:view:own',
      'hr.settings:view:all',
      'hr.settings:manage:all',
      'hr.strikes:view:own',
      'hr.strikes:view:all',
      'hr.strikes:manage:all',
      'hr.audit:view:all',
      'hr.audit:export:all',
      'employee.calendar:view:own',
      'employee.schedule:view:own',
      'employee.accountability:view:own',
      'employee.requests:submit:own'
    ]
  },
  {
    roleKey: 'hr_staff',
    roleName: 'HR Staff',
    description: 'HR operations with own-scope defaults and request handling.',
    isSystem: true,
    permissions: [
      'hr.schedule:view:own',
      'hr.meeting_attendance:view:own',
      'hr.shift_attendance:view:own',
      'hr.requests:submit:own',
      'employee.calendar:view:own',
      'employee.schedule:view:own',
      'employee.accountability:view:own',
      'employee.requests:submit:own'
    ]
  },
  {
    roleKey: 'inventory_admin',
    roleName: 'Inventory Admin',
    description: 'Full inventory management including session creation/finalize/upload.',
    isSystem: true,
    permissions: [
      'inventory.catalog:view:all',
      'inventory.catalog:edit:all',
      'inventory.catalog:import:all',
      'inventory.sessions:join:assigned_location',
      'inventory.sessions:create:all',
      'inventory.sessions:edit:all',
      'inventory.counts:view:own',
      'inventory.counts:view:all',
      'inventory.counts:edit:all',
      'inventory.finalize_upload:view:own',
      'inventory.finalize_upload:view:all',
      'inventory.finalize_upload:finalize:all',
      'inventory.finalize_upload:upload:all',
      'inventory.finalize_upload:lock:all',
      'inventory.calendar:view:all',
      'inventory.attendance:view:all',
      'inventory.attendance:edit:all',
      'inventory.attendance:override:all',
      'inventory.attendance:requests:approve:all'
    ]
  },
  {
    roleKey: 'inventory_counter',
    roleName: 'Inventory Counter',
    description: 'Join inventory sessions and submit counts; no session creation/finalization.',
    isSystem: true,
    permissions: [
      'inventory.sessions:join:assigned_location',
      'inventory.counts:view:own',
      'inventory.catalog:view:all'
    ]
  },
  {
    roleKey: 'finance_manager',
    roleName: 'Finance Manager',
    description: 'Finance uploads and reporting.',
    isSystem: true,
    permissions: [
      'finance.upload:view:own',
      'finance.upload:view:all',
      'finance.upload:upload:all',
      'finance.reports:view:all',
      'finance.reports:edit:all',
      'finance.reports:export:all',
      'finance.calendar:view:all'
    ]
  },
  {
    roleKey: 'marketing_manager',
    roleName: 'Marketing Manager',
    description: 'Marketing events and reporting.',
    isSystem: true,
    permissions: [
      'marketing.events:view:own',
      'marketing.events:view:all',
      'marketing.events:edit:all',
      'marketing.events:publish:all',
      'marketing.contacts:view:all',
      'marketing.contacts:edit:all',
      'marketing.coordinators:view:all',
      'marketing.coordinators:edit:all',
      'marketing.reports:view:all',
      'marketing.reports:edit:all',
      'marketing.reports:export:all',
      'marketing.calendars:view:all',
      'marketing.calendars:manage:all',
      'marketing.settings:view:all',
      'marketing.settings:manage:all'
    ]
  },
  {
    roleKey: 'product_manager',
    roleName: 'Product Manager',
    description: 'Manage product purchasing and catalog workflows.',
    isSystem: true,
    permissions: [
      'product.orders:view:own',
      'product.orders:view:all',
      'product.orders:edit:all',
      'product.orders:approve:all',
      'product.orders:order:all',
      'product.prompts:view:all',
      'product.prompts:edit:all',
      'product.prompts:convert:all',
      'product.products:view:all',
      'product.products:edit:all',
      'product.vendors:view:all',
      'product.vendors:edit:all',
      'product.designs:view:all',
      'product.designs:edit:all',
      'product.wishlist:view:own',
      'product.wishlist:view:all',
      'product.wishlist:edit:all',
      'product.wishlist:convert:all',
      'product.settings:view:all',
      'product.settings:manage:all',
      'product.calendar:view:all'
    ]
  },
  {
    roleKey: 'employee_self_service',
    roleName: 'Employee Self Service',
    description: 'Default self-service employee access.',
    isSystem: true,
    permissions: [
      'employee.calendar:view:own',
      'employee.schedule:view:own',
      'employee.schedule:submit:own',
      'employee.accountability:view:own',
      'employee.requests:submit:own',
      'employee.hours:submit:own',
      'employee.inventory_checks:view:own',
      'employee.inventory_checks:signup:own',
      'employee.inventory_checks:request_change:own',
      'hr.schedule:view:own',
      'hr.requests:submit:own'
    ]
  },
  {
    roleKey: 'viewer',
    roleName: 'Viewer',
    description: 'Read-only cross-department visibility.',
    isSystem: true,
    permissions: [
      'executive.overview:view:all',
      'finance.reports:view:all',
      'marketing.events:view:all',
      'product.products:view:all',
      'inventory.catalog:view:all',
      'employee.calendar:view:all'
    ]
  }
];

export const ROLE_BY_KEY = new Map(BASELINE_ROLES.map((role) => [role.roleKey, role]));

export const HOME_NAV_SECTIONS: NavSectionDefinition[] = [
  {
    id: 'executive',
    label: 'Executive',
    children: [
      { id: 'executive-overview', label: 'Executive', href: '/executive', permission: 'executive.overview:view:all' }
    ]
  },
  {
    id: 'hr',
    label: 'HR',
    children: [{ id: 'hr-home', label: 'HR', href: '/hr', permission: 'hr.schedule:view:own' }]
  },
  {
    id: 'product',
    label: 'Product',
    children: [{ id: 'product-home', label: 'Product', href: '/product', permission: 'product.products:view:all' }]
  },
  {
    id: 'marketing',
    label: 'Marketing',
    children: [{ id: 'marketing-home', label: 'Marketing', href: '/marketing', permission: 'marketing.events:view:own' }]
  },
  {
    id: 'finance',
    label: 'Finance',
    children: [{ id: 'finance-home', label: 'Finance', href: '/finance', permission: 'finance.reports:view:all' }]
  },
  {
    id: 'inventory',
    label: 'Inventory',
    children: [{ id: 'inventory-home', label: 'Inventory', href: '/inventory', permission: 'inventory.sessions:join:assigned_location' }]
  },
  {
    id: 'employee',
    label: 'Employee',
    children: [{ id: 'employee-home', label: 'Employee', href: '/employee', permission: 'employee.schedule:view:own' }]
  },
  {
    id: 'cfa',
    label: 'Chick-fil-A',
    children: [{ id: 'cfa-home', label: 'Chick-fil-A', href: '/cfa', permission: 'cfa.logs:view:all' }]
  }
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.permissionKey);
