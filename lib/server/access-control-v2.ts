import 'server-only';

import { canonicalizePermissions, expandForLegacyClients } from '@/lib/access/engine';
import { ALL_PERMISSION_KEYS, PERMISSION_BY_KEY } from '@/lib/access/registry';
import { PermissionKey } from '@/lib/access/types';
import { createServerClient } from '@/lib/supabase';

export interface AccessRoleRecordV2 {
  role_key: string;
  role_name: string;
  description: string | null;
  role_priority: number;
  is_system: boolean;
  is_active: boolean;
  role_permissions: string[];
  updated_at: string;
}

export interface EmployeeAccessRecordV2 {
  employee_id: string;
  employee_name: string;
  s_number: string;
  primary_role_key: string | null;
  role_keys: string[];
  role_permissions: string[];
  effective_permissions: string[];
  updated_at: string;
}

async function ensurePermissionCatalogRows(
  permissionKeys: string[]
): Promise<void> {
  const normalized = Array.from(new Set(permissionKeys))
    .filter((permission) => ALL_PERMISSION_KEYS.includes(permission as PermissionKey));
  if (normalized.length === 0) return;

  const supabase = createServerClient();
  const { data: existingRows, error: existingError } = await supabase
    .from('access_permissions')
    .select('permission_key')
    .in('permission_key', normalized);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existing = new Set(
    ((existingRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.permission_key ?? '').trim())
      .filter(Boolean)
  );

  const missingRows = normalized
    .filter((permissionKey) => !existing.has(permissionKey))
    .map((permissionKey) => {
      const definition = PERMISSION_BY_KEY.get(permissionKey as PermissionKey);
      if (!definition) return null;
      return {
        permission_key: definition.permissionKey,
        department: definition.department,
        resource: definition.resource,
        action: definition.action,
        scope: definition.scope,
        label: definition.label,
        description: definition.description ?? null,
        is_active: true
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (missingRows.length === 0) return;

  const { error: insertError } = await supabase
    .from('access_permissions')
    .upsert(missingRows, { onConflict: 'permission_key' });

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function loadRolePermissionsMap(): Promise<Map<string, string[]>> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('access_role_permissions')
    .select('role_key,permission_key');

  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const roleKey = String(row.role_key ?? '');
    const permissionKey = String(row.permission_key ?? '').trim();
    if (!roleKey || !permissionKey) continue;
    const bucket = map.get(roleKey) ?? [];
    bucket.push(permissionKey);
    map.set(roleKey, bucket);
  }
  return map;
}

export async function listRolesV2(): Promise<AccessRoleRecordV2[]> {
  const supabase = createServerClient();
  const [rolesResult, rolePermissionsMap] = await Promise.all([
    supabase
      .from('access_roles')
      .select('role_key,role_name,description,role_priority,is_system,is_active,updated_at')
      .order('is_system', { ascending: false })
      .order('role_priority', { ascending: false })
      .order('role_name', { ascending: true }),
    loadRolePermissionsMap()
  ]);

  return ((rolesResult.data ?? []) as Array<Record<string, unknown>>).map((role) => {
    const roleKey = String(role.role_key ?? '');
    return {
      role_key: roleKey,
      role_name: String(role.role_name ?? ''),
      description: role.description ? String(role.description) : null,
      role_priority: Number(role.role_priority ?? 100),
      is_system: Boolean(role.is_system),
      is_active: Boolean(role.is_active),
      role_permissions: rolePermissionsMap.get(roleKey) ?? [],
      updated_at: String(role.updated_at ?? '')
    };
  });
}

export async function createRoleV2(input: {
  role_key: string;
  role_name: string;
  description?: string | null;
  role_priority?: number;
  role_permissions: string[];
}): Promise<AccessRoleRecordV2> {
  const supabase = createServerClient();

  const { data: role, error: roleError } = await supabase
    .from('access_roles')
    .insert({
      role_key: input.role_key,
      role_name: input.role_name,
      description: input.description ?? null,
      role_priority: Number.isFinite(input.role_priority) ? Math.trunc(input.role_priority ?? 100) : 100,
      is_system: false,
      is_active: true
    })
    .select('role_key,role_name,description,role_priority,is_system,is_active,updated_at')
    .single();

  if (roleError || !role) {
    throw new Error(roleError?.message ?? 'Failed to create role.');
  }

  const permissionRows = Array.from(new Set(input.role_permissions))
    .filter((permission) => ALL_PERMISSION_KEYS.includes(permission as PermissionKey))
    .map((permission) => ({ role_key: input.role_key, permission_key: permission }));

  if (permissionRows.length > 0) {
    await ensurePermissionCatalogRows(permissionRows.map((row) => row.permission_key));
    const { error: permissionError } = await supabase.from('access_role_permissions').insert(permissionRows);
    if (permissionError) {
      throw new Error(permissionError.message);
    }
  }

  return {
    role_key: String(role.role_key ?? ''),
    role_name: String(role.role_name ?? ''),
    description: role.description ? String(role.description) : null,
    role_priority: Number(role.role_priority ?? 100),
    is_system: Boolean(role.is_system),
    is_active: Boolean(role.is_active),
    role_permissions: permissionRows.map((row) => row.permission_key),
    updated_at: String(role.updated_at ?? '')
  };
}

export async function updateRoleV2(
  roleKey: string,
  input: {
    role_name?: string;
    description?: string | null;
    role_priority?: number;
    is_active?: boolean;
    role_permissions?: string[];
  }
): Promise<AccessRoleRecordV2> {
  const supabase = createServerClient();

  const patch: Record<string, unknown> = {};
  if (typeof input.role_name === 'string') patch.role_name = input.role_name;
  if ('description' in input) patch.description = input.description ?? null;
  if (typeof input.role_priority === 'number' && Number.isFinite(input.role_priority)) {
    patch.role_priority = Math.trunc(input.role_priority);
  }
  if (typeof input.is_active === 'boolean') patch.is_active = input.is_active;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('access_roles').update(patch).eq('role_key', roleKey);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (Array.isArray(input.role_permissions)) {
    const normalized = Array.from(new Set(input.role_permissions)).filter((permission) =>
      ALL_PERMISSION_KEYS.includes(permission as PermissionKey)
    );

    const { error: deleteError } = await supabase
      .from('access_role_permissions')
      .delete()
      .eq('role_key', roleKey);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (normalized.length > 0) {
      await ensurePermissionCatalogRows(normalized);
      const { error: insertError } = await supabase.from('access_role_permissions').insert(
        normalized.map((permission) => ({ role_key: roleKey, permission_key: permission }))
      );
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  const [roles, permissionsMap] = await Promise.all([
    supabase
      .from('access_roles')
      .select('role_key,role_name,description,role_priority,is_system,is_active,updated_at')
      .eq('role_key', roleKey)
      .single(),
    loadRolePermissionsMap()
  ]);

  if (roles.error || !roles.data) {
    throw new Error(roles.error?.message ?? 'Unable to load role.');
  }

  return {
    role_key: String(roles.data.role_key ?? ''),
    role_name: String(roles.data.role_name ?? ''),
    description: roles.data.description ? String(roles.data.description) : null,
    role_priority: Number(roles.data.role_priority ?? 100),
    is_system: Boolean(roles.data.is_system),
    is_active: Boolean(roles.data.is_active),
    role_permissions: permissionsMap.get(roleKey) ?? [],
    updated_at: String(roles.data.updated_at ?? '')
  };
}

export async function listEmployeeAccessV2(): Promise<EmployeeAccessRecordV2[]> {
  const supabase = createServerClient();

  const [{ data: students }, { data: assignments }, rolePermissionsMap] = await Promise.all([
    supabase.from('students').select('id,name,s_number').order('name', { ascending: true }),
    supabase
      .from('employee_role_assignments')
      .select('employee_id,role_key,is_primary,updated_at,created_at')
      .order('created_at', { ascending: true }),
    loadRolePermissionsMap()
  ]);

  const rolesByEmployee = new Map<string, Array<{ role_key: string; is_primary: boolean; updated_at: string }>>();
  for (const row of (assignments ?? []) as Array<Record<string, unknown>>) {
    const employeeId = String(row.employee_id ?? '');
    const roleKey = String(row.role_key ?? '');
    if (!employeeId || !roleKey) continue;
    const bucket = rolesByEmployee.get(employeeId) ?? [];
    bucket.push({
      role_key: roleKey,
      is_primary: Boolean(row.is_primary),
      updated_at: String(row.updated_at ?? row.created_at ?? '')
    });
    rolesByEmployee.set(employeeId, bucket);
  }

  return ((students ?? []) as Array<Record<string, unknown>>).map((student) => {
    const employeeId = String(student.id ?? '');
    const assignmentsForUser = rolesByEmployee.get(employeeId) ?? [];
    const roleKeys = assignmentsForUser.map((assignment) => assignment.role_key);
    const primaryRoleKey =
      assignmentsForUser.find((assignment) => assignment.is_primary)?.role_key ?? roleKeys[0] ?? null;

    const rolePermissionSet = new Set<string>();
    for (const roleKey of roleKeys) {
      for (const permission of rolePermissionsMap.get(roleKey) ?? []) {
        rolePermissionSet.add(permission);
      }
    }
    const canonicalResolved = canonicalizePermissions(Array.from(rolePermissionSet));
    const effectivePermissions = expandForLegacyClients(canonicalResolved);
    const sortedUpdates = assignmentsForUser
      .map((assignment) => assignment.updated_at)
      .filter(Boolean)
      .sort();
    const latestUpdateAt = sortedUpdates.length > 0 ? sortedUpdates[sortedUpdates.length - 1] : null;

    return {
      employee_id: employeeId,
      employee_name: String(student.name ?? ''),
      s_number: String(student.s_number ?? ''),
      primary_role_key: primaryRoleKey,
      role_keys: roleKeys,
      role_permissions: Array.from(rolePermissionSet),
      effective_permissions: effectivePermissions,
      updated_at: latestUpdateAt ?? new Date(0).toISOString()
    };
  });
}

export async function updateEmployeeRoleAssignmentsV2(input: {
  employee_id: string;
  primary_role_key: string;
  secondary_role_keys?: string[];
}): Promise<void> {
  const supabase = createServerClient();
  const roleKeys = Array.from(
    new Set([input.primary_role_key, ...(input.secondary_role_keys ?? [])].filter(Boolean))
  );

  await supabase.from('employee_role_assignments').delete().eq('employee_id', input.employee_id);

  if (roleKeys.length === 0) return;

  const { error } = await supabase.from('employee_role_assignments').insert(
    roleKeys.map((roleKey) => ({
      employee_id: input.employee_id,
      role_key: roleKey,
      is_primary: roleKey === input.primary_role_key
    }))
  );

  if (error) {
    throw new Error(error.message);
  }
}
