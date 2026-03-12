'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildVisibleNav, canonicalizePermissions } from '@/lib/access/engine';
import { BASELINE_ROLES, PERMISSIONS } from '@/lib/access/registry';
import { DepartmentKey } from '@/lib/access/types';
import { usePermission } from '@/lib/permissions';

type EditorMode = 'roles' | 'employees';

type RoleRow = {
  role_key: string;
  role_name: string;
  description: string | null;
  role_priority: number;
  is_system: boolean;
  is_active: boolean;
  role_permissions: string[];
  updated_at: string;
};

type EmployeeRow = {
  employee_id: string;
  employee_name: string;
  s_number: string;
  primary_role_key: string | null;
  role_keys: string[];
  role_permissions: string[];
  effective_permissions: string[];
  updated_at: string;
};

type RoleDraft = {
  role_name: string;
  description: string;
  role_priority: number;
  is_active: boolean;
  role_permissions: string[];
  updated_at: string;
};

type EmployeeDraft = {
  primary_role_key: string;
  secondary_role_keys: string[];
  password: string;
  updated_at: string;
};

const DEPARTMENT_ORDER: DepartmentKey[] = [
  'executive',
  'hr',
  'cfa',
  'finance',
  'marketing',
  'product',
  'inventory',
  'employee'
];

function toRoleDraft(role: RoleRow): RoleDraft {
  return {
    role_name: role.role_name,
    description: role.description ?? '',
    role_priority: Number(role.role_priority ?? 100),
    is_active: role.is_active,
    role_permissions: role.role_permissions,
    updated_at: role.updated_at
  };
}

function toEmployeeDraft(employee: EmployeeRow): EmployeeDraft {
  const primary = employee.primary_role_key ?? employee.role_keys[0] ?? 'employee_self_service';
  return {
    primary_role_key: primary,
    secondary_role_keys: employee.role_keys.filter((roleKey) => roleKey !== primary),
    password: '',
    updated_at: employee.updated_at
  };
}

function normalizeRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function isRoleChanged(role: RoleRow, draft: RoleDraft | undefined): boolean {
  if (!draft) return false;
  if (draft.updated_at !== role.updated_at) return true;
  if (draft.role_name !== role.role_name) return true;
  if ((draft.description || '') !== (role.description || '')) return true;
  if (Number(draft.role_priority) !== Number(role.role_priority)) return true;
  if (draft.is_active !== role.is_active) return true;
  const next = [...draft.role_permissions].sort().join('|');
  const current = [...role.role_permissions].sort().join('|');
  return next !== current;
}

function isEmployeeChanged(employee: EmployeeRow, draft: EmployeeDraft | undefined): boolean {
  if (!draft) return false;
  if (draft.updated_at !== employee.updated_at) return true;
  const currentPrimary = employee.primary_role_key ?? employee.role_keys[0] ?? 'employee_self_service';
  if (draft.primary_role_key !== currentPrimary) return true;
  const currentSecondary = employee.role_keys.filter((roleKey) => roleKey !== currentPrimary).sort().join('|');
  const nextSecondary = [...draft.secondary_role_keys].sort().join('|');
  if (currentSecondary !== nextSecondary) return true;
  return draft.password.trim().length > 0;
}

interface AccessControlTabProps {
  initialEditorMode?: EditorMode;
  openAddEmployeeSignal?: number;
}

export function AccessControlTab(props: AccessControlTabProps = {}) {
  const canViewAccess = usePermission('executive.access:view:all');
  const canViewLegacyAccess = usePermission('executive.access_control.view');
  const canManageAccess = usePermission('executive.access:manage:all');
  const canManageLegacyAccess = usePermission('executive.access_control.edit');
  const canView = canViewAccess || canViewLegacyAccess;
  const canEdit = canManageAccess || canManageLegacyAccess;

  const [editorMode, setEditorMode] = useState<EditorMode>(props.initialEditorMode ?? 'roles');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  const [selectedRoleKey, setSelectedRoleKey] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

  const [roleDraftByKey, setRoleDraftByKey] = useState<Record<string, RoleDraft>>({});
  const [employeeDraftById, setEmployeeDraftById] = useState<Record<string, EmployeeDraft>>({});

  const [employeeSearch, setEmployeeSearch] = useState('');

  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePriority, setNewRolePriority] = useState('100');

  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeSNumber, setNewEmployeeSNumber] = useState('');
  const [newEmployeePassword, setNewEmployeePassword] = useState('');

  const permissionGroups = useMemo(() => {
    const group = new Map<DepartmentKey, Map<string, typeof PERMISSIONS>>();
    for (const permission of PERMISSIONS) {
      const departmentMap = group.get(permission.department) ?? new Map<string, typeof PERMISSIONS>();
      const resourceKey = permission.resource;
      const resourceEntries = departmentMap.get(resourceKey) ?? [];
      resourceEntries.push(permission);
      departmentMap.set(resourceKey, resourceEntries);
      group.set(permission.department, departmentMap);
    }

    return DEPARTMENT_ORDER.map((department) => {
      const resourceMap = group.get(department) ?? new Map<string, typeof PERMISSIONS>();
      const resources = Array.from(resourceMap.entries())
        .map(([resource, items]) => ({
          resource,
          items: [...items].sort((a, b) => a.action.localeCompare(b.action))
        }))
        .sort((a, b) => a.resource.localeCompare(b.resource));
      return { department, resources };
    }).filter((entry) => entry.resources.length > 0);
  }, []);

  const loadData = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setStatus('');

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
        throw new Error(rolesPayload.error ?? 'Unable to load roles.');
      }
      if (!employeesResponse.ok || !employeesPayload.ok || !employeesPayload.employees) {
        throw new Error(employeesPayload.error ?? 'Unable to load employees.');
      }

      setRoles(rolesPayload.roles);
      setEmployees(employeesPayload.employees);

      const nextRoleDrafts: Record<string, RoleDraft> = {};
      for (const role of rolesPayload.roles) {
        nextRoleDrafts[role.role_key] = toRoleDraft(role);
      }
      setRoleDraftByKey(nextRoleDrafts);

      const nextEmployeeDrafts: Record<string, EmployeeDraft> = {};
      for (const employee of employeesPayload.employees) {
        nextEmployeeDrafts[employee.employee_id] = toEmployeeDraft(employee);
      }
      setEmployeeDraftById(nextEmployeeDrafts);

      if (rolesPayload.roles.length > 0) {
        setSelectedRoleKey((previous) => previous || rolesPayload.roles?.[0]?.role_key || '');
      }
      if (employeesPayload.employees.length > 0) {
        setSelectedEmployeeId((previous) => previous || employeesPayload.employees?.[0]?.employee_id || '');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load access control state.');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!props.openAddEmployeeSignal) return;
    setEditorMode('employees');
  }, [props.openAddEmployeeSignal]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.role_key === selectedRoleKey) ?? null,
    [roles, selectedRoleKey]
  );
  const selectedRoleDraft = selectedRole ? roleDraftByKey[selectedRole.role_key] : undefined;

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.employee_id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );
  const selectedEmployeeDraft = selectedEmployee ? employeeDraftById[selectedEmployee.employee_id] : undefined;

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) =>
      [employee.employee_name, employee.s_number, employee.primary_role_key ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [employeeSearch, employees]);

  const rolePreview = useMemo(() => {
    const draft = selectedRoleDraft;
    if (!draft) return [];
    return buildVisibleNav(undefined, canonicalizePermissions(draft.role_permissions));
  }, [selectedRoleDraft]);

  const setRoleDraft = (patch: Partial<RoleDraft>) => {
    if (!selectedRole) return;
    setRoleDraftByKey((previous) => ({
      ...previous,
      [selectedRole.role_key]: {
        ...(previous[selectedRole.role_key] ?? toRoleDraft(selectedRole)),
        ...patch
      }
    }));
  };

  const setEmployeeDraft = (patch: Partial<EmployeeDraft>) => {
    if (!selectedEmployee) return;
    setEmployeeDraftById((previous) => ({
      ...previous,
      [selectedEmployee.employee_id]: {
        ...(previous[selectedEmployee.employee_id] ?? toEmployeeDraft(selectedEmployee)),
        ...patch
      }
    }));
  };

  const togglePermission = (permissionKey: string) => {
    if (!selectedRoleDraft) return;
    const set = new Set(selectedRoleDraft.role_permissions);
    if (set.has(permissionKey)) {
      set.delete(permissionKey);
    } else {
      set.add(permissionKey);
    }
    setRoleDraft({ role_permissions: Array.from(set) });
  };

  const applyPreset = (roleKey: string) => {
    const preset = BASELINE_ROLES.find((role) => role.roleKey === roleKey);
    if (!preset) return;
    setRoleDraft({ role_permissions: [...preset.permissions] });
    setStatus(`Applied preset: ${preset.roleName}.`);
  };

  const saveRole = async () => {
    if (!selectedRole || !selectedRoleDraft) return;
    setStatus('');
    const response = await fetch(`/api/executive/access/roles/${selectedRole.role_key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role_name: selectedRoleDraft.role_name,
        description: selectedRoleDraft.description || null,
        role_priority: selectedRoleDraft.role_priority,
        is_active: selectedRoleDraft.is_active,
        role_permissions: selectedRoleDraft.role_permissions
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to save role.');
      return;
    }

    setStatus('Role saved. Refreshing...');
    await loadData();
    setStatus('Role saved.');
  };

  const createRole = async () => {
    const roleName = newRoleName.trim();
    if (!roleName) {
      setStatus('Role name is required.');
      return;
    }

    const roleKey = normalizeRoleKey(roleName);
    if (!roleKey) {
      setStatus('Role name must contain letters or numbers.');
      return;
    }

    const response = await fetch('/api/executive/access/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role_key: roleKey,
        role_name: roleName,
        description: newRoleDescription || null,
        role_priority: Number.isFinite(Number(newRolePriority)) ? Math.trunc(Number(newRolePriority)) : 100,
        role_permissions: []
      })
    });

    const payload = (await response.json()) as { ok: boolean; role?: RoleRow; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to create role.');
      return;
    }

    setNewRoleName('');
    setNewRoleDescription('');
    setNewRolePriority('100');
    await loadData();
    setSelectedRoleKey(roleKey);
    setStatus('Role created.');
  };

  const duplicateRole = async () => {
    if (!selectedRoleDraft || !selectedRole) return;

    const duplicateKey = `${selectedRole.role_key}_copy`;
    const response = await fetch('/api/executive/access/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role_key: duplicateKey,
        role_name: `${selectedRole.role_name} Copy`,
        description: selectedRole.description,
        role_priority: selectedRoleDraft.role_priority,
        role_permissions: selectedRoleDraft.role_permissions
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to duplicate role.');
      return;
    }

    await loadData();
    setSelectedRoleKey(duplicateKey);
    setStatus('Role duplicated.');
  };

  const saveEmployee = async () => {
    if (!selectedEmployee || !selectedEmployeeDraft) return;

    const response = await fetch(`/api/executive/access/employees/${selectedEmployee.employee_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_role_key: selectedEmployeeDraft.primary_role_key,
        secondary_role_keys: selectedEmployeeDraft.secondary_role_keys,
        password: selectedEmployeeDraft.password
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to save employee role assignment.');
      return;
    }

    await loadData();
    setStatus('Employee assignment saved.');
  };

  const createEmployee = async () => {
    const name = newEmployeeName.trim();
    const sNumber = newEmployeeSNumber.trim();
    if (!name || !sNumber) {
      setStatus('Employee name and S-number are required.');
      return;
    }

    const response = await fetch('/api/executive/access/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        s_number: sNumber,
        password: newEmployeePassword.trim() || undefined
      })
    });

    const payload = (await response.json()) as { ok: boolean; employee_id?: string; error?: string };
    if (!response.ok || !payload.ok) {
      setStatus(payload.error ?? 'Unable to create employee.');
      return;
    }

    setNewEmployeeName('');
    setNewEmployeeSNumber('');
    setNewEmployeePassword('');
    await loadData();
    if (payload.employee_id) {
      setSelectedEmployeeId(String(payload.employee_id));
    }
    setStatus('Employee created and assigned default role.');
  };

  if (!canView) {
    return (
      <section className="border border-neutral-300 bg-white p-4 text-sm text-neutral-700">
        You do not have permission to view Access Control.
      </section>
    );
  }

  return (
    <section className="space-y-3 border border-neutral-300 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Roles & Access</h2>
          <p className="text-sm text-neutral-600">Flat permission model with live DB-backed role assignment.</p>
        </div>
        <div className="flex gap-2">
          <button
            className={`border px-3 py-1.5 text-sm ${editorMode === 'roles' ? 'border-brand-maroon bg-brand-maroon text-white' : 'border-neutral-300 bg-white text-neutral-800'}`}
            onClick={() => setEditorMode('roles')}
            type="button"
          >
            Roles
          </button>
          <button
            className={`border px-3 py-1.5 text-sm ${editorMode === 'employees' ? 'border-brand-maroon bg-brand-maroon text-white' : 'border-neutral-300 bg-white text-neutral-800'}`}
            onClick={() => setEditorMode('employees')}
            type="button"
          >
            Employees
          </button>
          <button className="border border-neutral-300 px-3 py-1.5 text-sm" onClick={() => void loadData()} type="button">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {status ? <p className="text-sm text-neutral-700">{status}</p> : null}

      {editorMode === 'roles' ? (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3 border border-neutral-200 p-3">
            <h3 className="text-sm font-semibold text-neutral-800">Roles</h3>
            <div className="max-h-72 overflow-y-auto border border-neutral-200">
              {roles.map((role) => (
                <button
                  className={`block w-full border-b border-neutral-200 px-3 py-2 text-left text-sm ${selectedRoleKey === role.role_key ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'}`}
                  key={role.role_key}
                  onClick={() => setSelectedRoleKey(role.role_key)}
                  type="button"
                >
                  <div className="font-medium">{role.role_name}</div>
                  <div className="text-xs opacity-80">{role.role_key}</div>
                </button>
              ))}
            </div>

            {canEdit ? (
              <div className="space-y-2 border-t border-neutral-200 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Create Role</h4>
                <input
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  onChange={(event) => setNewRoleName(event.target.value)}
                  placeholder="Role name"
                  value={newRoleName}
                />
                <textarea
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  onChange={(event) => setNewRoleDescription(event.target.value)}
                  placeholder="Description"
                  rows={2}
                  value={newRoleDescription}
                />
                <input
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  inputMode="numeric"
                  onChange={(event) => setNewRolePriority(event.target.value)}
                  placeholder="Priority (100 employee, 200 director, 300 executive)"
                  value={newRolePriority}
                />
                <button className="w-full border border-brand-maroon bg-brand-maroon px-3 py-1.5 text-sm text-white" onClick={() => void createRole()} type="button">
                  Create Role
                </button>
              </div>
            ) : null}
          </aside>

          <section className="space-y-3">
            {selectedRole && selectedRoleDraft ? (
              <>
                <div className="border border-neutral-200 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-neutral-700">
                      Role Name
                      <input
                        className="mt-1 w-full border border-neutral-300 px-2 py-1.5"
                        disabled={!canEdit}
                        onChange={(event) => setRoleDraft({ role_name: event.target.value })}
                        value={selectedRoleDraft.role_name}
                      />
                    </label>
                    <label className="text-sm text-neutral-700">
                      Role Key
                      <input className="mt-1 w-full border border-neutral-300 bg-neutral-100 px-2 py-1.5" disabled value={selectedRole.role_key} />
                    </label>
                    <label className="text-sm text-neutral-700">
                      Role Priority
                      <input
                        className="mt-1 w-full border border-neutral-300 px-2 py-1.5"
                        disabled={!canEdit}
                        inputMode="numeric"
                        onChange={(event) =>
                          setRoleDraft({
                            role_priority: Number.isFinite(Number(event.target.value))
                              ? Math.trunc(Number(event.target.value))
                              : 0
                          })
                        }
                        value={String(selectedRoleDraft.role_priority)}
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm text-neutral-700">
                    Description
                    <textarea
                      className="mt-1 w-full border border-neutral-300 px-2 py-1.5"
                      disabled={!canEdit}
                      onChange={(event) => setRoleDraft({ description: event.target.value })}
                      rows={2}
                      value={selectedRoleDraft.description}
                    />
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      checked={selectedRoleDraft.is_active}
                      disabled={!canEdit || selectedRole.is_system}
                      onChange={(event) => setRoleDraft({ is_active: event.target.checked })}
                      type="checkbox"
                    />
                    Active role
                  </label>

                  {canEdit ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="border border-brand-maroon bg-brand-maroon px-3 py-1.5 text-sm text-white disabled:opacity-60"
                        disabled={!isRoleChanged(selectedRole, selectedRoleDraft)}
                        onClick={() => void saveRole()}
                        type="button"
                      >
                        Save Role
                      </button>
                      <button className="border border-neutral-300 px-3 py-1.5 text-sm" onClick={() => void duplicateRole()} type="button">
                        Duplicate Role
                      </button>
                      <select className="border border-neutral-300 px-2 py-1.5 text-sm" onChange={(event) => applyPreset(event.target.value)} value="">
                        <option value="">Apply baseline preset...</option>
                        {BASELINE_ROLES.map((preset) => (
                          <option key={preset.roleKey} value={preset.roleKey}>
                            {preset.roleName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                <div className="border border-neutral-200 p-3">
                  <h3 className="text-sm font-semibold text-neutral-800">Permission Matrix</h3>
                  <div className="mt-3 space-y-3">
                    {permissionGroups.map((department) => (
                      <section className="border border-neutral-200" key={department.department}>
                        <header className="border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-neutral-700">
                          {department.department}
                        </header>
                        <div className="divide-y divide-neutral-200">
                          {department.resources.map((resource) => (
                            <div className="grid gap-2 px-3 py-2 md:grid-cols-[220px_minmax(0,1fr)]" key={`${department.department}:${resource.resource}`}>
                              <div className="text-sm font-medium text-neutral-800">{resource.resource.replaceAll('_', ' ')}</div>
                              <div className="flex flex-wrap gap-2">
                                {resource.items.map((permission) => {
                                  const checked = selectedRoleDraft.role_permissions.includes(permission.permissionKey);
                                  return (
                                    <label className="inline-flex items-center gap-1.5 border border-neutral-300 bg-white px-2 py-1 text-xs" key={permission.permissionKey}>
                                      <input
                                        checked={checked}
                                        disabled={!canEdit}
                                        onChange={() => togglePermission(permission.permissionKey)}
                                        type="checkbox"
                                      />
                                      <span>{permission.action}{permission.scope ? `:${permission.scope}` : ''}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>

                <div className="border border-neutral-200 p-3">
                  <h3 className="text-sm font-semibold text-neutral-800">Sidebar Preview</h3>
                  {rolePreview.length === 0 ? (
                    <p className="mt-2 text-sm text-neutral-600">No visible sections for this role.</p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {rolePreview.map((section) => (
                        <div className="border border-neutral-200 p-2" key={section.id}>
                          <p className="text-sm font-medium text-neutral-900">{section.label}</p>
                          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-700">
                            {section.children.map((child) => (
                              <li key={child.id}>{child.label}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-700">Select a role to edit permissions.</p>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-3 border border-neutral-200 p-3">
            <h3 className="text-sm font-semibold text-neutral-800">Employees</h3>
            <input
              className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search name, S-number, role"
              value={employeeSearch}
            />
            <div className="max-h-[420px] overflow-y-auto border border-neutral-200">
              {filteredEmployees.map((employee) => (
                <button
                  className={`block w-full border-b border-neutral-200 px-3 py-2 text-left text-sm ${selectedEmployeeId === employee.employee_id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'}`}
                  key={employee.employee_id}
                  onClick={() => setSelectedEmployeeId(employee.employee_id)}
                  type="button"
                >
                  <div className="font-medium">{employee.employee_name}</div>
                  <div className="text-xs opacity-80">{employee.s_number} | {employee.primary_role_key ?? 'unassigned'}</div>
                </button>
              ))}
            </div>

            {canEdit ? (
              <div className="space-y-2 border-t border-neutral-200 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Create Employee</h4>
                <input
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  onChange={(event) => setNewEmployeeName(event.target.value)}
                  placeholder="Employee name"
                  value={newEmployeeName}
                />
                <input
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  onChange={(event) => setNewEmployeeSNumber(event.target.value)}
                  placeholder="S-number"
                  value={newEmployeeSNumber}
                />
                <input
                  className="w-full border border-neutral-300 px-2 py-1.5 text-sm"
                  onChange={(event) => setNewEmployeePassword(event.target.value)}
                  placeholder="Optional password"
                  type="password"
                  value={newEmployeePassword}
                />
                <button className="w-full border border-brand-maroon bg-brand-maroon px-3 py-1.5 text-sm text-white" onClick={() => void createEmployee()} type="button">
                  Create Employee
                </button>
              </div>
            ) : null}
          </aside>

          <section className="space-y-3">
            {selectedEmployee && selectedEmployeeDraft ? (
              <div className="border border-neutral-200 p-3">
                <h3 className="text-base font-semibold text-neutral-900">{selectedEmployee.employee_name}</h3>
                <p className="text-sm text-neutral-600">{selectedEmployee.s_number}</p>

                <label className="mt-3 block text-sm text-neutral-700">
                  Primary Role
                  <select
                    className="mt-1 w-full border border-neutral-300 px-2 py-1.5"
                    disabled={!canEdit}
                    onChange={(event) => {
                      const nextPrimary = event.target.value;
                      const nextSecondary = selectedEmployeeDraft.secondary_role_keys.filter((roleKey) => roleKey !== nextPrimary);
                      setEmployeeDraft({ primary_role_key: nextPrimary, secondary_role_keys: nextSecondary });
                    }}
                    value={selectedEmployeeDraft.primary_role_key}
                  >
                    {roles.map((role) => (
                      <option key={role.role_key} value={role.role_key}>
                        {role.role_name} ({role.role_key})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mt-3">
                  <p className="text-sm font-medium text-neutral-800">Secondary Roles</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {roles
                      .filter((role) => role.role_key !== selectedEmployeeDraft.primary_role_key)
                      .map((role) => {
                        const checked = selectedEmployeeDraft.secondary_role_keys.includes(role.role_key);
                        return (
                          <label className="inline-flex items-center gap-2 border border-neutral-300 px-2 py-1.5 text-sm" key={role.role_key}>
                            <input
                              checked={checked}
                              disabled={!canEdit}
                              onChange={(event) => {
                                const set = new Set(selectedEmployeeDraft.secondary_role_keys);
                                if (event.target.checked) {
                                  set.add(role.role_key);
                                } else {
                                  set.delete(role.role_key);
                                }
                                setEmployeeDraft({ secondary_role_keys: Array.from(set) });
                              }}
                              type="checkbox"
                            />
                            {role.role_name}
                          </label>
                        );
                      })}
                  </div>
                </div>

                {canEdit ? (
                  <label className="mt-3 block text-sm text-neutral-700">
                    Reset Password (optional)
                    <input
                      className="mt-1 w-full border border-neutral-300 px-2 py-1.5"
                      onChange={(event) => setEmployeeDraft({ password: event.target.value })}
                      type="password"
                      value={selectedEmployeeDraft.password}
                    />
                  </label>
                ) : null}

                <div className="mt-3 border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-700">
                  Effective permissions: {selectedEmployee.effective_permissions.length}
                </div>

                {canEdit ? (
                  <button
                    className="mt-3 border border-brand-maroon bg-brand-maroon px-3 py-1.5 text-sm text-white disabled:opacity-60"
                    disabled={!isEmployeeChanged(selectedEmployee, selectedEmployeeDraft)}
                    onClick={() => void saveEmployee()}
                    type="button"
                  >
                    Save Assignment
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-neutral-700">Select an employee to assign roles.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
