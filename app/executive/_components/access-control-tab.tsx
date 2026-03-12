'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { useCurrentUser, usePermission } from '@/lib/permissions';

type EditorMode = 'employees' | 'roles';
type DepartmentKey = 'executive' | 'hr' | 'cfa' | 'finance' | 'marketing' | 'product' | 'inventory' | 'employee';
type AccessMode = 'none' | 'view' | 'edit';

type RoleRow = {
  id: string;
  role_key: string;
  role_name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
};

type EmployeeRow = {
  employee_id: string;
  employee_name: string;
  s_number: string;
  role_template_id: string | null;
  role_key: string | null;
  role_name: string | null;
  permissions: string[];
  overrides: Array<{ permission_key: string; effect: 'allow' | 'deny' }>;
};

type FeaturePermission = {
  id: string;
  department: DepartmentKey;
  label: string;
  viewPermission?: string;
  editPermission?: string;
};

const DEPARTMENTS: Array<{ key: DepartmentKey; label: string }> = [
  { key: 'executive', label: 'Executive' },
  { key: 'hr', label: 'HR' },
  { key: 'cfa', label: 'CFA' },
  { key: 'finance', label: 'Finance' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'product', label: 'Product' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'employee', label: 'Employee' }
];

const FEATURE_CATALOG: FeaturePermission[] = [
  { id: 'executive_ai_agent', department: 'executive', label: 'AI Agent', viewPermission: 'executive.ai_agent.view', editPermission: 'executive.ai_agent.edit' },
  { id: 'executive_overview', department: 'executive', label: 'Overview', viewPermission: 'executive.overview.view' },
  { id: 'executive_feed', department: 'executive', label: 'Department Feed', viewPermission: 'executive.department_feed.view' },
  { id: 'executive_alerts', department: 'executive', label: 'Alerts', viewPermission: 'executive.alerts.view' },
  { id: 'executive_metrics', department: 'executive', label: 'Metrics', viewPermission: 'executive.metrics.view' },
  { id: 'executive_reports', department: 'executive', label: 'Reports', viewPermission: 'executive.reports.view' },
  { id: 'executive_calendar', department: 'executive', label: 'Calendar', viewPermission: 'executive.calendar.view' },
  { id: 'executive_access', department: 'executive', label: 'Access Control', viewPermission: 'executive.access_control.view', editPermission: 'executive.access_control.edit' },
  { id: 'hr_schedule', department: 'hr', label: 'Schedule', viewPermission: 'hr.schedule.view', editPermission: 'hr.schedule.edit' },
  { id: 'hr_attendance', department: 'hr', label: 'Attendance', viewPermission: 'hr.attendance.view', editPermission: 'hr.attendance.override' },
  { id: 'hr_requests', department: 'hr', label: 'Requests', viewPermission: 'hr.requests.view', editPermission: 'hr.requests.edit' },
  { id: 'hr_settings', department: 'hr', label: 'Settings', editPermission: 'hr.settings.edit' },
  { id: 'hr_strikes', department: 'hr', label: 'Strikes', editPermission: 'hr.strikes.manage' },
  { id: 'hr_calendar', department: 'hr', label: 'Calendar', viewPermission: 'hr.calendar.view' },
  { id: 'cfa_logs', department: 'cfa', label: 'Logs', viewPermission: 'cfa.logs.read', editPermission: 'cfa.logs.write' },
  { id: 'cfa_menu', department: 'cfa', label: 'Menu', editPermission: 'cfa.menu.manage' },
  { id: 'cfa_day_type', department: 'cfa', label: 'Day Type Override', editPermission: 'cfa.day_type.override' },
  { id: 'cfa_exports', department: 'cfa', label: 'Exports', editPermission: 'cfa.exports' },
  { id: 'finance_upload', department: 'finance', label: 'Upload', viewPermission: 'finance.upload.view', editPermission: 'finance.upload.edit' },
  { id: 'finance_reports', department: 'finance', label: 'Reports', viewPermission: 'finance.reports.view', editPermission: 'finance.reports.edit' },
  { id: 'finance_calendar', department: 'finance', label: 'Calendar', viewPermission: 'finance.calendar.view' },
  { id: 'marketing_events', department: 'marketing', label: 'Events', viewPermission: 'marketing.events.view', editPermission: 'marketing.events.edit' },
  { id: 'marketing_contacts', department: 'marketing', label: 'Contacts', viewPermission: 'marketing.contacts.view', editPermission: 'marketing.contacts.edit' },
  { id: 'marketing_coordinators', department: 'marketing', label: 'Coordinators', viewPermission: 'marketing.coordinators.view', editPermission: 'marketing.coordinators.edit' },
  { id: 'marketing_reports', department: 'marketing', label: 'Reports', viewPermission: 'marketing.reports.view', editPermission: 'marketing.reports.edit' },
  { id: 'marketing_settings', department: 'marketing', label: 'Settings', viewPermission: 'marketing.settings.view', editPermission: 'marketing.settings.edit' },
  { id: 'marketing_calendar', department: 'marketing', label: 'Calendars', viewPermission: 'marketing.calendar.view', editPermission: 'marketing.shared_calendar.view' },
  { id: 'product_orders', department: 'product', label: 'Orders', viewPermission: 'product.orders.view', editPermission: 'product.orders.edit' },
  { id: 'product_prompts', department: 'product', label: 'Prompts', viewPermission: 'product.prompts.view', editPermission: 'product.prompts.edit' },
  { id: 'product_products', department: 'product', label: 'Products', viewPermission: 'product.products.view', editPermission: 'product.products.edit' },
  { id: 'product_vendors', department: 'product', label: 'Vendors', viewPermission: 'product.vendors.view', editPermission: 'product.vendors.edit' },
  { id: 'product_designs', department: 'product', label: 'Designs', viewPermission: 'product.designs.view', editPermission: 'product.designs.edit' },
  { id: 'product_wishlist', department: 'product', label: 'Wishlist', viewPermission: 'product.wishlist.view', editPermission: 'product.wishlist.edit' },
  { id: 'product_settings', department: 'product', label: 'Settings', viewPermission: 'product.settings.view', editPermission: 'product.settings.edit' },
  { id: 'product_calendar', department: 'product', label: 'Calendar', viewPermission: 'product.calendar.view' },
  { id: 'inventory_catalog', department: 'inventory', label: 'Catalog', viewPermission: 'inventory.catalog.view', editPermission: 'inventory.catalog.edit' },
  { id: 'inventory_sessions', department: 'inventory', label: 'Sessions', viewPermission: 'inventory.sessions.view', editPermission: 'inventory.sessions.edit' },
  { id: 'inventory_count', department: 'inventory', label: 'Count View', viewPermission: 'inventory.count_view.view', editPermission: 'inventory.count_view.edit' },
  { id: 'inventory_finalize', department: 'inventory', label: 'Finalize & Upload', viewPermission: 'inventory.finalize_upload.view', editPermission: 'inventory.finalize_upload.edit' },
  { id: 'inventory_calendar', department: 'inventory', label: 'Calendar', viewPermission: 'inventory.calendar.view' },
  { id: 'employee_calendar', department: 'employee', label: 'Calendar', viewPermission: 'employee.calendar.view' },
  { id: 'employee_schedule', department: 'employee', label: 'Schedule', viewPermission: 'employee.schedule.view' },
  { id: 'employee_accountability', department: 'employee', label: 'Accountability', viewPermission: 'employee.accountability.view' },
  { id: 'employee_requests', department: 'employee', label: 'Requests', viewPermission: 'employee.requests.view', editPermission: 'employee.requests.edit' }
];

function modeFromPermissions(feature: FeaturePermission, permissions: string[]): AccessMode {
  const hasView = feature.viewPermission ? permissions.includes(feature.viewPermission) : false;
  const hasEdit = feature.editPermission ? permissions.includes(feature.editPermission) : false;
  if (hasEdit) return 'edit';
  if (hasView) return 'view';
  return 'none';
}

function featureModesFromPermissions(permissions: string[]): Record<string, AccessMode> {
  const next: Record<string, AccessMode> = {};
  for (const feature of FEATURE_CATALOG) {
    next[feature.id] = modeFromPermissions(feature, permissions);
  }
  return next;
}

function permissionsFromModes(modes: Record<string, AccessMode>): string[] {
  const set = new Set<string>();
  for (const feature of FEATURE_CATALOG) {
    const mode = modes[feature.id] ?? 'none';
    if (mode === 'view') {
      if (feature.viewPermission) set.add(feature.viewPermission);
      continue;
    }
    if (mode === 'edit') {
      if (feature.viewPermission) set.add(feature.viewPermission);
      if (feature.editPermission) set.add(feature.editPermission);
    }
  }
  return Array.from(set);
}

function overridesFromModes(modes: Record<string, AccessMode>) {
  const overrides: Array<{ permission_key: string; effect: 'allow' | 'deny' }> = [];
  for (const feature of FEATURE_CATALOG) {
    const mode = modes[feature.id] ?? 'none';
    if (mode === 'view') {
      if (feature.viewPermission) overrides.push({ permission_key: feature.viewPermission, effect: 'allow' });
      if (feature.editPermission) overrides.push({ permission_key: feature.editPermission, effect: 'deny' });
      continue;
    }
    if (mode === 'edit') {
      if (feature.viewPermission) overrides.push({ permission_key: feature.viewPermission, effect: 'allow' });
      if (feature.editPermission) overrides.push({ permission_key: feature.editPermission, effect: 'allow' });
      continue;
    }
    if (feature.viewPermission) overrides.push({ permission_key: feature.viewPermission, effect: 'deny' });
    if (feature.editPermission) overrides.push({ permission_key: feature.editPermission, effect: 'deny' });
  }
  return overrides;
}

function setDepartmentMode(
  current: Record<string, AccessMode>,
  department: DepartmentKey,
  mode: AccessMode
): Record<string, AccessMode> {
  const next = { ...current };
  for (const feature of FEATURE_CATALOG) {
    if (feature.department !== department) continue;
    if (mode === 'edit') {
      if (feature.editPermission) next[feature.id] = 'edit';
      else if (feature.viewPermission) next[feature.id] = 'view';
      else next[feature.id] = 'none';
      continue;
    }
    if (mode === 'view') {
      if (feature.viewPermission) next[feature.id] = 'view';
      else next[feature.id] = 'none';
      continue;
    }
    next[feature.id] = 'none';
  }
  return next;
}

function getDepartmentMode(modes: Record<string, AccessMode>, department: DepartmentKey): AccessMode {
  let hasView = false;
  for (const feature of FEATURE_CATALOG) {
    if (feature.department !== department) continue;
    const mode = modes[feature.id] ?? 'none';
    if (mode === 'edit') return 'edit';
    if (mode === 'view') hasView = true;
  }
  return hasView ? 'view' : 'none';
}

function departmentBadgeClass(department: DepartmentKey): string {
  switch (department) {
    case 'executive':
      return 'border-rose-300 bg-rose-100 text-rose-800';
    case 'hr':
      return 'border-sky-300 bg-sky-100 text-sky-800';
    case 'cfa':
      return 'border-amber-300 bg-amber-100 text-amber-800';
    case 'finance':
      return 'border-emerald-300 bg-emerald-100 text-emerald-800';
    case 'marketing':
      return 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800';
    case 'product':
      return 'border-indigo-300 bg-indigo-100 text-indigo-800';
    case 'inventory':
      return 'border-orange-300 bg-orange-100 text-orange-800';
    case 'employee':
      return 'border-slate-300 bg-slate-100 text-slate-800';
    default:
      return 'border-neutral-300 bg-neutral-100 text-neutral-700';
  }
}

function roleSummary(baseRole: string, hasCustom: boolean): string {
  const base = baseRole || 'No role';
  return hasCustom ? `${base} + extra (custom)` : base;
}

function replaceWithDepartmentViewOverlay(
  current: Record<string, AccessMode>,
  department: DepartmentKey
): Record<string, AccessMode> {
  const next: Record<string, AccessMode> = {};
  for (const feature of FEATURE_CATALOG) {
    if (feature.department === department && feature.viewPermission) {
      next[feature.id] = 'view';
    } else {
      next[feature.id] = 'none';
    }
  }
  return { ...current, ...next };
}

interface AccessControlTabProps {
  initialEditorMode?: EditorMode;
  openAddEmployeeSignal?: number;
}

export function AccessControlTab(props: AccessControlTabProps = {}) {
  const canViewExecutive = usePermission('executive.access_control.view');
  const canEditExecutive = usePermission('executive.access_control.edit');
  const canView = canViewExecutive || canEditExecutive;
  const canEdit = canEditExecutive;
  const { user } = useCurrentUser();

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [editorMode, setEditorMode] = useState<EditorMode>(props.initialEditorMode ?? 'employees');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleName, setNewRoleName] = useState('');

  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedRoleDepartment, setSelectedRoleDepartment] = useState<DepartmentKey>('executive');
  const [roleModesByRoleId, setRoleModesByRoleId] = useState<Record<string, Record<string, AccessMode>>>({});
  const [roleDepartmentBulkMode, setRoleDepartmentBulkMode] = useState<AccessMode>('none');

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeRoleDraftById, setEmployeeRoleDraftById] = useState<Record<string, string>>({});
  const [employeePasswordDraftById, setEmployeePasswordDraftById] = useState<Record<string, string>>({});
  const [employeeModesById, setEmployeeModesById] = useState<Record<string, Record<string, AccessMode>>>({});
  const [employeeDepartmentQuickById, setEmployeeDepartmentQuickById] = useState<
    Record<string, DepartmentKey>
  >({});
  const [showAllDepartmentsById, setShowAllDepartmentsById] = useState<Record<string, boolean>>({});

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customDepartment, setCustomDepartment] = useState<DepartmentKey>('executive');
  const [customDepartmentMode, setCustomDepartmentMode] = useState<AccessMode>('none');

  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeSNumber, setNewEmployeeSNumber] = useState('');
  const [newEmployeePassword, setNewEmployeePassword] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const [rolesResponse, employeesResponse] = await Promise.all([
        fetch('/api/executive/access/roles', { cache: 'no-store' }),
        fetch('/api/executive/access/employees', { cache: 'no-store' })
      ]);

      const rolesPayload = (await rolesResponse.json()) as { ok: boolean; roles?: RoleRow[]; error?: string };
      const employeesPayload = (await employeesResponse.json()) as {
        ok: boolean;
        employees?: EmployeeRow[];
        error?: string;
      };

      if (!rolesResponse.ok || !rolesPayload.ok || !rolesPayload.roles) {
        throw new Error(rolesPayload.error ?? 'Unable to load role templates.');
      }
      if (!employeesResponse.ok || !employeesPayload.ok || !employeesPayload.employees) {
        throw new Error(employeesPayload.error ?? 'Unable to load employee access.');
      }

      const roleRows = rolesPayload.roles;
      const employeeRows = employeesPayload.employees;

      setRoles(roleRows);
      setEmployees(employeeRows);

      setRoleModesByRoleId((previous) => {
        const next = { ...previous };
        for (const role of roleRows) {
          next[role.id] = featureModesFromPermissions(role.permissions);
        }
        return next;
      });

      setEmployeeModesById((previous) => {
        const next = { ...previous };
        for (const employee of employeeRows) {
          next[employee.employee_id] = featureModesFromPermissions(employee.permissions);
        }
        return next;
      });

      setEmployeeRoleDraftById((previous) => {
        const next = { ...previous };
        for (const employee of employeeRows) {
          next[employee.employee_id] = employee.role_template_id ?? '';
        }
        return next;
      });

      setEmployeeDepartmentQuickById((previous) => {
        const next = { ...previous };
        for (const employee of employeeRows) {
          const current =
            previous[employee.employee_id] ??
            (DEPARTMENTS.find(
              (department) =>
                getDepartmentMode(featureModesFromPermissions(employee.permissions), department.key) !== 'none'
            )?.key ??
              'employee');
          next[employee.employee_id] = current;
        }
        return next;
      });

      if (roleRows.length > 0) {
        setSelectedRoleId((previous) => previous || roleRows[0].id);
      }
      if (employeeRows.length > 0) {
        setSelectedEmployeeId((previous) => previous || employeeRows[0].employee_id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load access data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!props.openAddEmployeeSignal) return;
    setEditorMode('employees');
    setAddEmployeeOpen(true);
  }, [props.openAddEmployeeSignal]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((employee) =>
      [employee.employee_name, employee.s_number, employee.role_name ?? '', employee.role_key ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [employeeSearch, employees]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.employee_id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );

  const roleMetaById = useMemo(() => {
    const next = new Map<string, { role_name: string; role_key: string }>();
    for (const role of roles) {
      next.set(role.id, { role_name: role.role_name, role_key: role.role_key });
    }
    return next;
  }, [roles]);

  const roleDepartmentFeatures = useMemo(
    () => FEATURE_CATALOG.filter((feature) => feature.department === selectedRoleDepartment),
    [selectedRoleDepartment]
  );

  const customDepartmentFeatures = useMemo(
    () => FEATURE_CATALOG.filter((feature) => feature.department === customDepartment),
    [customDepartment]
  );

  const createRole = async () => {
    if (!canEdit) return;
    if (!newRoleKey.trim() || !newRoleName.trim()) {
      setStatus('Role key and name are required.');
      return;
    }

    const response = await fetch('/api/executive/access/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role_key: newRoleKey.trim(),
        role_name: newRoleName.trim(),
        permissions: []
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to create role.');
      return;
    }

    setNewRoleKey('');
    setNewRoleName('');
    setStatus('Role created.');
    await loadData();
  };

  const saveSelectedRole = async () => {
    if (!canEdit || !selectedRole) return;

    const permissions = permissionsFromModes(roleModesByRoleId[selectedRole.id] ?? {});

    const response = await fetch(`/api/executive/access/roles/${selectedRole.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to update role permissions.');
      return;
    }

    setStatus(`Saved role template: ${selectedRole.role_name}.`);
    await loadData();
  };

  const saveEmployee = async (
    employee: EmployeeRow,
    explicitModes?: Record<string, AccessMode>
  ): Promise<boolean> => {
    if (!canEdit) return false;

    const roleTemplateId = employeeRoleDraftById[employee.employee_id] ?? '';
    const password = employeePasswordDraftById[employee.employee_id] ?? '';
    const baseModes =
      explicitModes ??
      employeeModesById[employee.employee_id] ??
      featureModesFromPermissions(employee.permissions);
    const quickDepartment = employeeDepartmentQuickById[employee.employee_id] ?? 'employee';
    const effectiveModes = explicitModes
      ? baseModes
      : replaceWithDepartmentViewOverlay(baseModes, quickDepartment);
    const overrides = overridesFromModes(effectiveModes);

    const response = await fetch(`/api/executive/access/employees/${employee.employee_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role_template_id: roleTemplateId,
        overrides,
        password: password.trim() || undefined
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to save employee settings.');
      return false;
    }

    setEmployeePasswordDraftById((previous) => ({ ...previous, [employee.employee_id]: '' }));
    setStatus(`Saved employee: ${employee.employee_name}.`);
    await loadData();
    return true;
  };

  const createEmployeeFromExec = async () => {
    if (!canEdit) return;
    if (!newEmployeeName.trim() || !newEmployeeSNumber.trim()) {
      setStatus('Employee name and s_number are required.');
      return;
    }

    const response = await fetch('/api/executive/access/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newEmployeeName.trim(),
        s_number: newEmployeeSNumber.trim(),
        password: newEmployeePassword.trim() || undefined
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to create employee.');
      return;
    }

    setNewEmployeeName('');
    setNewEmployeeSNumber('');
    setNewEmployeePassword('');
    setAddEmployeeOpen(false);
    setStatus('Employee created from Executive access.');
    await loadData();
  };

  if (!canView) {
    return <p className="p-4 text-sm text-neutral-700">You do not have permission to view access control.</p>;
  }

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-700">
        <span>
          Signed in as {user?.id ?? 'unknown'} ({user?.role ?? 'unknown role'})
        </span>
        <label className="text-xs">
          Editor
          <select
            className="ml-2 min-h-[34px] border border-neutral-300 px-2"
            onChange={(event) => setEditorMode(event.target.value as EditorMode)}
            value={editorMode}
          >
            <option value="employees">Employee Editing</option>
            <option value="roles">Role Template Editing</option>
          </select>
        </label>
      </div>

      {editorMode === 'roles' ? (
        <section className="space-y-3 border border-neutral-300 p-3">
          <h3 className="text-sm font-semibold">Role Template Editing</h3>

          <div className="grid gap-2 md:grid-cols-3">
            <input
              className="min-h-[40px] border border-neutral-300 px-2 text-sm"
              onChange={(event) => setNewRoleKey(event.target.value)}
              placeholder="role_key"
              value={newRoleKey}
            />
            <input
              className="min-h-[40px] border border-neutral-300 px-2 text-sm"
              onChange={(event) => setNewRoleName(event.target.value)}
              placeholder="role_name"
              value={newRoleName}
            />
            <button
              className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-50"
              disabled={!canEdit}
              onClick={() => {
                void createRole();
              }}
              type="button"
            >
              Create Role
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <label className="text-xs">
              Role Template
              <select
                className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                onChange={(event) => setSelectedRoleId(event.target.value)}
                value={selectedRoleId}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.role_name} ({role.role_key})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              Department
              <select
                className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                onChange={(event) => setSelectedRoleDepartment(event.target.value as DepartmentKey)}
                value={selectedRoleDepartment}
              >
                {DEPARTMENTS.map((department) => (
                  <option key={department.key} value={department.key}>
                    {department.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              Department Bulk Mode
              <select
                className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                onChange={(event) => setRoleDepartmentBulkMode(event.target.value as AccessMode)}
                value={roleDepartmentBulkMode}
              >
                <option value="none">none</option>
                <option value="view">view</option>
                <option value="edit">edit</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              className="min-h-[36px] border border-neutral-500 px-3 text-xs disabled:opacity-50"
              disabled={!canEdit || !selectedRole}
              onClick={() => {
                if (!selectedRole) return;
                setRoleModesByRoleId((previous) => ({
                  ...previous,
                  [selectedRole.id]: setDepartmentMode(
                    previous[selectedRole.id] ?? {},
                    selectedRoleDepartment,
                    roleDepartmentBulkMode
                  )
                }));
              }}
              type="button"
            >
              Apply Department Mode
            </button>
            <button
              className="min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:opacity-50"
              disabled={!canEdit || !selectedRole}
              onClick={() => {
                void saveSelectedRole();
              }}
              type="button"
            >
              Save Role Permissions
            </button>
          </div>

          {selectedRole ? (
            <div className="grid gap-2 md:grid-cols-2">
              {roleDepartmentFeatures.map((feature) => {
                const mode = roleModesByRoleId[selectedRole.id]?.[feature.id] ?? 'none';
                return (
                  <label className="text-xs" key={`role-${selectedRole.id}-${feature.id}`}>
                    {feature.label}
                    <select
                      className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                      onChange={(event) => {
                        setRoleModesByRoleId((previous) => ({
                          ...previous,
                          [selectedRole.id]: {
                            ...(previous[selectedRole.id] ?? {}),
                            [feature.id]: event.target.value as AccessMode
                          }
                        }));
                      }}
                      value={mode}
                    >
                      <option value="none">none</option>
                      {feature.viewPermission ? <option value="view">view</option> : null}
                      {feature.editPermission ? <option value="edit">edit</option> : null}
                    </select>
                  </label>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {editorMode === 'employees' ? (
        <section className="space-y-3 border border-neutral-300 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Employee Editing</h3>
            <button
              className="min-h-[34px] border border-neutral-500 px-3 text-xs"
              onClick={() => setAddEmployeeOpen((value) => !value)}
              type="button"
            >
              {addEmployeeOpen ? 'Close Add Employee' : 'Add Employee'}
            </button>
          </div>

          {addEmployeeOpen ? (
            <div className="grid gap-2 border border-neutral-300 p-3 md:grid-cols-3">
              <input
                className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                onChange={(event) => setNewEmployeeName(event.target.value)}
                placeholder="Employee name"
                value={newEmployeeName}
              />
              <input
                className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                onChange={(event) => setNewEmployeeSNumber(event.target.value)}
                placeholder="s_number"
                value={newEmployeeSNumber}
              />
              <input
                className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                onChange={(event) => setNewEmployeePassword(event.target.value)}
                placeholder="Optional password"
                type="password"
                value={newEmployeePassword}
              />
              <p className="text-xs text-neutral-600 md:col-span-2">
                New employees default to the general Employee role and start as not schedulable.
              </p>
              <button
                className="min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:opacity-50"
                disabled={!canEdit}
                onClick={() => {
                  void createEmployeeFromExec();
                }}
                type="button"
              >
                Create Employee
              </button>
            </div>
          ) : null}

          <input
            className="min-h-[40px] w-full border border-neutral-300 px-2 text-sm"
            onChange={(event) => setEmployeeSearch(event.target.value)}
            placeholder="Search by name / s_number / role"
            value={employeeSearch}
          />

          <div className="border border-neutral-300">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-100">
                <tr>
                  <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Role Summary</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Departments</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => {
                  const baseModes =
                    employeeModesById[employee.employee_id] ??
                    featureModesFromPermissions(employee.permissions);
                  const quickDepartment = employeeDepartmentQuickById[employee.employee_id] ?? 'employee';
                  const effectiveModes = replaceWithDepartmentViewOverlay(baseModes, quickDepartment);
                  const draftedRoleId = employeeRoleDraftById[employee.employee_id];
                  const draftedRoleMeta = draftedRoleId ? roleMetaById.get(draftedRoleId) : null;
                  const roleLabel =
                    draftedRoleId === ''
                      ? 'No role'
                      : draftedRoleMeta?.role_name ?? employee.role_name ?? employee.role_key ?? 'No role';
                  const hasCustom = Array.isArray(employee.overrides) && employee.overrides.length > 0;
                  const isExpanded = selectedEmployeeId === employee.employee_id;
                  const activeDepartments = DEPARTMENTS.filter((department) => {
                    return getDepartmentMode(effectiveModes, department.key) !== 'none';
                  }).map((department) => ({
                    ...department,
                    mode: getDepartmentMode(effectiveModes, department.key)
                  }));
                  const showAll = Boolean(showAllDepartmentsById[employee.employee_id]);
                  const visibleDepartments = showAll ? activeDepartments : activeDepartments.slice(0, 1);

                  return (
                    <Fragment key={employee.employee_id}>
                      <tr
                        className={`cursor-pointer border-b border-neutral-200 ${
                          isExpanded ? 'bg-neutral-50' : ''
                        }`}
                        onClick={() =>
                          setSelectedEmployeeId((previous) =>
                            previous === employee.employee_id ? '' : employee.employee_id
                          )
                        }
                      >
                        <td className="p-2">
                          <span className="text-left">
                            {employee.employee_name} ({employee.s_number})
                          </span>
                        </td>
                        <td className="p-2">
                          <span className="text-left">
                            {roleSummary(roleLabel, hasCustom)}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {activeDepartments.length === 0 ? (
                              <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
                                none
                              </span>
                            ) : (
                              visibleDepartments.map((department) => (
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-xs ${departmentBadgeClass(
                                    department.key
                                  )}`}
                                  key={`${employee.employee_id}-${department.key}`}
                                >
                                  {department.label}
                                </span>
                              ))
                            )}
                            {activeDepartments.length > 1 ? (
                              <button
                                className="text-xs text-neutral-700 underline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setShowAllDepartmentsById((previous) => ({
                                    ...previous,
                                    [employee.employee_id]: !showAll
                                  }));
                                }}
                                type="button"
                              >
                                {showAll
                                  ? 'show less'
                                  : `show ${activeDepartments.length - visibleDepartments.length} more`}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="border-b border-neutral-200 bg-white">
                          <td className="p-3" colSpan={3}>
                            <div className="grid gap-2 md:grid-cols-3">
                              <label className="text-xs">
                                Role Template
                                <select
                                  className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) =>
                                    setEmployeeRoleDraftById((previous) => ({
                                      ...previous,
                                      [employee.employee_id]: event.target.value
                                    }))
                                  }
                                  value={employeeRoleDraftById[employee.employee_id] ?? ''}
                                >
                                  <option value="">No role</option>
                                  {roles.map((role) => (
                                    <option key={role.id} value={role.id}>
                                      {role.role_name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="text-xs">
                                Change Password
                                <input
                                  className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) =>
                                    setEmployeePasswordDraftById((previous) => ({
                                      ...previous,
                                      [employee.employee_id]: event.target.value
                                    }))
                                  }
                                  type="password"
                                  value={employeePasswordDraftById[employee.employee_id] ?? ''}
                                />
                              </label>

                              <label className="text-xs">
                                Quick Department (view for whole department)
                                <select
                                  className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) =>
                                    setEmployeeDepartmentQuickById((previous) => ({
                                      ...previous,
                                      [employee.employee_id]: event.target.value as DepartmentKey
                                    }))
                                  }
                                  value={employeeDepartmentQuickById[employee.employee_id] ?? 'employee'}
                                >
                                  {DEPARTMENTS.map((department) => (
                                    <option key={department.key} value={department.key}>
                                      {department.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                className="min-h-[34px] border border-neutral-500 px-3 text-xs"
                                onClick={() => {
                                  setSelectedEmployeeId(employee.employee_id);
                                  setCustomModalOpen(true);
                                  setCustomDepartment(
                                    employeeDepartmentQuickById[employee.employee_id] ?? 'employee'
                                  );
                                  setCustomDepartmentMode('view');
                                }}
                                type="button"
                              >
                                Custom Edit Roles
                              </button>

                              <button
                                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:opacity-50"
                                disabled={!canEdit}
                                onClick={() => {
                                  void saveEmployee(employee);
                                }}
                                type="button"
                              >
                                Save Employee Access
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {customModalOpen && selectedEmployee ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto border border-neutral-400 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-base font-semibold">
                Custom Edit: {selectedEmployee.employee_name} ({selectedEmployee.s_number})
              </h4>
              <button
                className="min-h-[34px] border border-neutral-500 px-3 text-xs"
                onClick={() => setCustomModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <label className="text-xs">
                Role Template
                <select
                  className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setEmployeeRoleDraftById((previous) => ({
                      ...previous,
                      [selectedEmployee.employee_id]: event.target.value
                    }))
                  }
                  value={employeeRoleDraftById[selectedEmployee.employee_id] ?? ''}
                >
                  <option value="">No role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.role_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs">
                Password
                <input
                  className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setEmployeePasswordDraftById((previous) => ({
                      ...previous,
                      [selectedEmployee.employee_id]: event.target.value
                    }))
                  }
                  type="password"
                  value={employeePasswordDraftById[selectedEmployee.employee_id] ?? ''}
                />
              </label>

              <div className="text-xs">
                <p>Department Bulk Mode</p>
                <div className="mt-1 flex gap-1">
                  <select
                    className="min-h-[34px] w-full border border-neutral-300 px-2"
                    onChange={(event) => setCustomDepartment(event.target.value as DepartmentKey)}
                    value={customDepartment}
                  >
                    {DEPARTMENTS.map((department) => (
                      <option key={department.key} value={department.key}>
                        {department.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="min-h-[34px] w-full border border-neutral-300 px-2"
                    onChange={(event) => setCustomDepartmentMode(event.target.value as AccessMode)}
                    value={customDepartmentMode}
                  >
                    <option value="none">none</option>
                    <option value="view">view</option>
                    <option value="edit">edit</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="min-h-[34px] border border-neutral-500 px-3 text-xs disabled:opacity-50"
                disabled={!canEdit}
                onClick={() => {
                  setEmployeeModesById((previous) => ({
                    ...previous,
                    [selectedEmployee.employee_id]: setDepartmentMode(
                      previous[selectedEmployee.employee_id] ?? {},
                      customDepartment,
                      customDepartmentMode
                    )
                  }));
                }}
                type="button"
              >
                Apply Department Mode
              </button>

              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:opacity-50"
                disabled={!canEdit}
                onClick={async () => {
                  const currentModes =
                    employeeModesById[selectedEmployee.employee_id] ??
                    featureModesFromPermissions(selectedEmployee.permissions);
                  const appliedModes = setDepartmentMode(
                    currentModes,
                    customDepartment,
                    customDepartmentMode
                  );

                  setEmployeeModesById((previous) => ({
                    ...previous,
                    [selectedEmployee.employee_id]: appliedModes
                  }));

                  const saved = await saveEmployee(selectedEmployee, appliedModes);
                  if (saved) {
                    setCustomModalOpen(false);
                  }
                }}
                type="button"
              >
                Save & Close
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {customDepartmentFeatures.map((feature) => {
                const mode = employeeModesById[selectedEmployee.employee_id]?.[feature.id] ?? 'none';
                return (
                  <label className="text-xs" key={`custom-${selectedEmployee.employee_id}-${feature.id}`}>
                    {feature.label}
                    <select
                      className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                      onChange={(event) => {
                        setEmployeeModesById((previous) => ({
                          ...previous,
                          [selectedEmployee.employee_id]: {
                            ...(previous[selectedEmployee.employee_id] ?? {}),
                            [feature.id]: event.target.value as AccessMode
                          }
                        }));
                      }}
                      value={mode}
                    >
                      <option value="none">none</option>
                      {feature.viewPermission ? <option value="view">view</option> : null}
                      {feature.editPermission ? <option value="edit">edit</option> : null}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-700">Loading access data...</p> : null}
      {status ? <p className="text-sm text-brand-maroon">{status}</p> : null}
    </section>
  );
}
