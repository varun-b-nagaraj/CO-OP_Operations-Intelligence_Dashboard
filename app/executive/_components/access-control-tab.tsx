'use client';

import { useEffect, useMemo, useState } from 'react';

import { useCurrentUser, usePermission } from '@/lib/permissions';

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
  label: string;
  viewPermission?: string;
  editPermission?: string;
};

const FEATURE_CATALOG: FeaturePermission[] = [
  { id: 'executive_ai_agent', label: 'Executive / AI Agent', viewPermission: 'executive.ai_agent.view', editPermission: 'executive.ai_agent.edit' },
  { id: 'executive_overview', label: 'Executive / Overview', viewPermission: 'executive.overview.view' },
  { id: 'executive_feed', label: 'Executive / Department Feed', viewPermission: 'executive.department_feed.view' },
  { id: 'executive_alerts', label: 'Executive / Alerts', viewPermission: 'executive.alerts.view' },
  { id: 'executive_metrics', label: 'Executive / Metrics', viewPermission: 'executive.metrics.view' },
  { id: 'executive_reports', label: 'Executive / Reports', viewPermission: 'executive.reports.view' },
  { id: 'executive_calendar', label: 'Executive / Calendar', viewPermission: 'executive.calendar.view' },
  { id: 'executive_access', label: 'Executive / Access Control', viewPermission: 'executive.access_control.view', editPermission: 'executive.access_control.edit' },
  { id: 'hr_schedule', label: 'HR / Schedule', viewPermission: 'hr.schedule.view', editPermission: 'hr.schedule.edit' },
  { id: 'hr_attendance', label: 'HR / Attendance', viewPermission: 'hr.attendance.view', editPermission: 'hr.attendance.override' },
  { id: 'hr_requests', label: 'HR / Requests', viewPermission: 'hr.requests.view', editPermission: 'hr.requests.edit' },
  { id: 'hr_audit', label: 'HR / Audit', viewPermission: 'hr.audit.view' },
  { id: 'hr_settings', label: 'HR / Settings', editPermission: 'hr.settings.edit' },
  { id: 'hr_strikes', label: 'HR / Strikes', editPermission: 'hr.strikes.manage' },
  { id: 'hr_calendar', label: 'HR / Calendar', viewPermission: 'hr.calendar.view' },
  { id: 'cfa_logs', label: 'CFA / Logs', viewPermission: 'cfa.logs.read', editPermission: 'cfa.logs.write' },
  { id: 'cfa_menu', label: 'CFA / Menu', editPermission: 'cfa.menu.manage' },
  { id: 'cfa_day_type', label: 'CFA / Day Type Override', editPermission: 'cfa.day_type.override' },
  { id: 'cfa_exports', label: 'CFA / Exports', editPermission: 'cfa.exports' },
  { id: 'finance_upload', label: 'Finance / Upload', viewPermission: 'finance.upload.view', editPermission: 'finance.upload.edit' },
  { id: 'finance_reports', label: 'Finance / Reports', viewPermission: 'finance.reports.view', editPermission: 'finance.reports.edit' },
  { id: 'finance_calendar', label: 'Finance / Calendar', viewPermission: 'finance.calendar.view' },
  { id: 'marketing_events', label: 'Marketing / Events', viewPermission: 'marketing.events.view', editPermission: 'marketing.events.edit' },
  { id: 'marketing_contacts', label: 'Marketing / Contacts', viewPermission: 'marketing.contacts.view', editPermission: 'marketing.contacts.edit' },
  { id: 'marketing_coordinators', label: 'Marketing / Coordinators', viewPermission: 'marketing.coordinators.view', editPermission: 'marketing.coordinators.edit' },
  { id: 'marketing_reports', label: 'Marketing / Reports', viewPermission: 'marketing.reports.view', editPermission: 'marketing.reports.edit' },
  { id: 'marketing_settings', label: 'Marketing / Settings', viewPermission: 'marketing.settings.view', editPermission: 'marketing.settings.edit' },
  { id: 'marketing_calendar', label: 'Marketing / Calendars', viewPermission: 'marketing.calendar.view', editPermission: 'marketing.shared_calendar.view' },
  { id: 'product_orders', label: 'Product / Orders', viewPermission: 'product.orders.view', editPermission: 'product.orders.edit' },
  { id: 'product_prompts', label: 'Product / Prompts', viewPermission: 'product.prompts.view', editPermission: 'product.prompts.edit' },
  { id: 'product_products', label: 'Product / Products', viewPermission: 'product.products.view', editPermission: 'product.products.edit' },
  { id: 'product_vendors', label: 'Product / Vendors', viewPermission: 'product.vendors.view', editPermission: 'product.vendors.edit' },
  { id: 'product_designs', label: 'Product / Designs', viewPermission: 'product.designs.view', editPermission: 'product.designs.edit' },
  { id: 'product_wishlist', label: 'Product / Wishlist', viewPermission: 'product.wishlist.view', editPermission: 'product.wishlist.edit' },
  { id: 'product_settings', label: 'Product / Settings', viewPermission: 'product.settings.view', editPermission: 'product.settings.edit' },
  { id: 'product_calendar', label: 'Product / Calendar', viewPermission: 'product.calendar.view' },
  { id: 'inventory_catalog', label: 'Inventory / Catalog', viewPermission: 'inventory.catalog.view', editPermission: 'inventory.catalog.edit' },
  { id: 'inventory_sessions', label: 'Inventory / Sessions', viewPermission: 'inventory.sessions.view', editPermission: 'inventory.sessions.edit' },
  { id: 'inventory_count', label: 'Inventory / Count View', viewPermission: 'inventory.count_view.view', editPermission: 'inventory.count_view.edit' },
  { id: 'inventory_finalize', label: 'Inventory / Finalize & Upload', viewPermission: 'inventory.finalize_upload.view', editPermission: 'inventory.finalize_upload.edit' },
  { id: 'inventory_calendar', label: 'Inventory / Calendar', viewPermission: 'inventory.calendar.view' },
  { id: 'employee_calendar', label: 'Employee / Calendar', viewPermission: 'employee.calendar.view' },
  { id: 'employee_schedule', label: 'Employee / Schedule', viewPermission: 'employee.schedule.view' },
  { id: 'employee_accountability', label: 'Employee / Accountability', viewPermission: 'employee.accountability.view' },
  { id: 'employee_requests', label: 'Employee / Requests', viewPermission: 'employee.requests.view', editPermission: 'employee.requests.edit' }
];

type ModeValue = 'inherit' | 'view' | 'edit' | 'none';

function modeFromPermissions(feature: FeaturePermission, permissions: string[]): ModeValue {
  const hasView = feature.viewPermission ? permissions.includes(feature.viewPermission) : false;
  const hasEdit = feature.editPermission ? permissions.includes(feature.editPermission) : false;

  if (hasEdit) return 'edit';
  if (hasView) return 'view';
  return 'none';
}

export function AccessControlTab() {
  const canView = usePermission('executive.access_control.view');
  const canEdit = usePermission('executive.access_control.edit');
  const { user } = useCurrentUser();

  const [status, setStatus] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [search, setSearch] = useState('');
  const [passwordDraftByEmployeeId, setPasswordDraftByEmployeeId] = useState<Record<string, string>>({});
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [modeByFeatureId, setModeByFeatureId] = useState<Record<string, ModeValue>>({});

  const loadData = async () => {
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

      setRoles(rolesPayload.roles);
      setEmployees(employeesPayload.employees);

      if (!selectedEmployeeId && employeesPayload.employees.length > 0) {
        const firstId = employeesPayload.employees[0].employee_id;
        setSelectedEmployeeId(firstId);
        const firstEmployee = employeesPayload.employees[0];
        const initialModes: Record<string, ModeValue> = {};
        for (const feature of FEATURE_CATALOG) {
          initialModes[feature.id] = modeFromPermissions(feature, firstEmployee.permissions);
        }
        setModeByFeatureId(initialModes);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load access data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.employee_id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );

  const filteredEmployees = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return employees;

    return employees.filter((employee) => {
      return [employee.employee_name, employee.s_number, employee.role_name ?? '', employee.role_key ?? '']
        .join(' ')
        .toLowerCase()
        .includes(value);
    });
  }, [employees, search]);

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

  const updateRolePermissions = async (role: RoleRow, permissions: string[]) => {
    if (!canEdit) return;

    const response = await fetch(`/api/executive/access/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to update role permissions.');
      return;
    }

    setStatus(`Updated permissions for role ${role.role_name}.`);
    await loadData();
  };

  const saveEmployeeAccess = async (employeeId: string, roleTemplateId: string) => {
    if (!canEdit) return;

    const password = passwordDraftByEmployeeId[employeeId] ?? '';

    const overrides: Array<{ permission_key: string; effect: 'allow' | 'deny' }> = [];
    for (const feature of FEATURE_CATALOG) {
      const mode = modeByFeatureId[feature.id] ?? 'inherit';
      if (mode === 'inherit') continue;

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

      if (mode === 'none') {
        if (feature.viewPermission) overrides.push({ permission_key: feature.viewPermission, effect: 'deny' });
        if (feature.editPermission) overrides.push({ permission_key: feature.editPermission, effect: 'deny' });
      }
    }

    const response = await fetch(`/api/executive/access/employees/${employeeId}`, {
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
      setStatus(payload.error ?? 'Unable to save employee access.');
      return;
    }

    setPasswordDraftByEmployeeId((previous) => ({ ...previous, [employeeId]: '' }));
    setStatus('Employee access saved.');
    await loadData();
  };

  if (!canView) {
    return <p className="p-4 text-sm text-neutral-700">You do not have permission to view access control.</p>;
  }

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div className="border border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-700">
        Signed in as {user?.id ?? 'unknown'} ({user?.role ?? 'unknown role'})
      </div>

      <section className="space-y-3 border border-neutral-300 p-3">
        <h3 className="text-sm font-semibold">Role Templates</h3>
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

        <div className="space-y-3">
          {roles.map((role) => {
            const current = new Set(role.permissions);
            return (
              <div className="border border-neutral-300 p-2" key={role.id}>
                <p className="text-sm font-medium">
                  {role.role_name} ({role.role_key}) {role.is_system ? '• system' : ''}
                </p>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  {FEATURE_CATALOG.map((feature) => {
                    const viewChecked = feature.viewPermission ? current.has(feature.viewPermission) : false;
                    const editChecked = feature.editPermission ? current.has(feature.editPermission) : false;

                    return (
                      <div className="border border-neutral-200 p-2" key={`${role.id}-${feature.id}`}>
                        <p className="text-xs font-medium text-neutral-800">{feature.label}</p>
                        <div className="mt-1 flex gap-2 text-xs">
                          {feature.viewPermission ? (
                            <label className="inline-flex items-center gap-1">
                              <input
                                checked={viewChecked}
                                disabled={!canEdit}
                                onChange={(event) => {
                                  const next = new Set(role.permissions);
                                  if (event.target.checked) next.add(feature.viewPermission!);
                                  else next.delete(feature.viewPermission!);
                                  void updateRolePermissions(role, Array.from(next));
                                }}
                                type="checkbox"
                              />
                              View
                            </label>
                          ) : null}

                          {feature.editPermission ? (
                            <label className="inline-flex items-center gap-1">
                              <input
                                checked={editChecked}
                                disabled={!canEdit}
                                onChange={(event) => {
                                  const next = new Set(role.permissions);
                                  if (event.target.checked) next.add(feature.editPermission!);
                                  else next.delete(feature.editPermission!);
                                  void updateRolePermissions(role, Array.from(next));
                                }}
                                type="checkbox"
                              />
                              Edit
                            </label>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 border border-neutral-300 p-3">
        <h3 className="text-sm font-semibold">Employee Access + Password</h3>
        <input
          className="min-h-[40px] w-full border border-neutral-300 px-2 text-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name / s_number / role"
          value={search}
        />

        <div className="border border-neutral-300">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-100">
              <tr>
                <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
                <th className="border-b border-neutral-300 p-2 text-left">Role</th>
                <th className="border-b border-neutral-300 p-2 text-left">Password</th>
                <th className="border-b border-neutral-300 p-2 text-left">Save</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr
                  className={`border-b border-neutral-200 ${selectedEmployeeId === employee.employee_id ? 'bg-neutral-50' : ''}`}
                  key={employee.employee_id}
                >
                  <td className="p-2">
                    <button
                      className="text-left underline"
                      onClick={() => {
                        setSelectedEmployeeId(employee.employee_id);
                        const initialModes: Record<string, ModeValue> = {};
                        for (const feature of FEATURE_CATALOG) {
                          initialModes[feature.id] = modeFromPermissions(feature, employee.permissions);
                        }
                        setModeByFeatureId(initialModes);
                      }}
                      type="button"
                    >
                      {employee.employee_name} ({employee.s_number})
                    </button>
                  </td>
                  <td className="p-2">
                    <select
                      className="min-h-[36px] border border-neutral-300 px-2"
                      defaultValue={employee.role_template_id ?? ''}
                      id={`role-${employee.employee_id}`}
                    >
                      <option value="">No role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.role_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      className="min-h-[36px] border border-neutral-300 px-2"
                      onChange={(event) =>
                        setPasswordDraftByEmployeeId((previous) => ({
                          ...previous,
                          [employee.employee_id]: event.target.value
                        }))
                      }
                      placeholder="Set new password"
                      type="password"
                      value={passwordDraftByEmployeeId[employee.employee_id] ?? ''}
                    />
                  </td>
                  <td className="p-2">
                    <button
                      className="min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-white disabled:opacity-50"
                      disabled={!canEdit}
                      onClick={() => {
                        const selectEl = document.getElementById(
                          `role-${employee.employee_id}`
                        ) as HTMLSelectElement | null;
                        void saveEmployeeAccess(employee.employee_id, selectEl?.value ?? '');
                      }}
                      type="button"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedEmployee ? (
          <section className="space-y-2 border border-neutral-300 p-3">
            <p className="text-sm font-medium">
              Override Modes for {selectedEmployee.employee_name} ({selectedEmployee.s_number})
            </p>
            <p className="text-xs text-neutral-600">
              `inherit` uses role defaults. `none` denies both view/edit where applicable.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {FEATURE_CATALOG.map((feature) => (
                <label className="text-xs" key={`mode-${feature.id}`}>
                  {feature.label}
                  <select
                    className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2"
                    onChange={(event) =>
                      setModeByFeatureId((previous) => ({
                        ...previous,
                        [feature.id]: event.target.value as ModeValue
                      }))
                    }
                    value={modeByFeatureId[feature.id] ?? 'inherit'}
                  >
                    <option value="inherit">inherit</option>
                    <option value="view">view</option>
                    <option value="edit">edit</option>
                    <option value="none">none</option>
                  </select>
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      {loading ? <p className="text-sm text-neutral-700">Loading access data...</p> : null}
      {status ? <p className="text-sm text-brand-maroon">{status}</p> : null}
    </section>
  );
}
