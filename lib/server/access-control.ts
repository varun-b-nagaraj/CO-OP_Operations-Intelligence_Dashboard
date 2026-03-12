import { createServerClient } from '@/lib/supabase';
import { resolveEffectivePermissions } from '@/lib/server/auth';

export interface AccessRoleTemplate {
  id: string;
  role_key: string;
  role_name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  created_at: string;
  updated_at: string;
}

export interface EmployeeAccessRecord {
  employee_id: string;
  employee_name: string;
  s_number: string;
  role_template_id: string | null;
  role_key: string | null;
  role_name: string | null;
  permissions: string[];
  overrides: Array<{ permission_key: string; effect: 'allow' | 'deny' }>;
}

export async function listRoleTemplates(): Promise<AccessRoleTemplate[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('access_role_templates')
    .select('*')
    .order('is_system', { ascending: false })
    .order('role_key', { ascending: true });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    role_key: String(row.role_key ?? ''),
    role_name: String(row.role_name ?? ''),
    description: (row.description as string | null) ?? null,
    is_system: Boolean(row.is_system),
    is_active: Boolean(row.is_active),
    permissions: Array.isArray(row.permissions)
      ? (row.permissions as unknown[]).map((value) => String(value)).filter(Boolean)
      : [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? '')
  }));
}

export async function createRoleTemplate(input: {
  role_key: string;
  role_name: string;
  description?: string | null;
  permissions: string[];
}) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('access_role_templates')
    .insert({
      role_key: input.role_key,
      role_name: input.role_name,
      description: input.description ?? null,
      is_system: false,
      is_active: true,
      permissions: input.permissions
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create role.');
  }

  return data;
}

export async function updateRoleTemplate(
  roleId: string,
  input: { role_name?: string; description?: string | null; is_active?: boolean; permissions?: string[] }
) {
  const supabase = createServerClient();
  const payload: Record<string, unknown> = {};

  if (typeof input.role_name === 'string') payload.role_name = input.role_name;
  if ('description' in input) payload.description = input.description ?? null;
  if (typeof input.is_active === 'boolean') payload.is_active = input.is_active;
  if (Array.isArray(input.permissions)) payload.permissions = input.permissions;

  const { data, error } = await supabase
    .from('access_role_templates')
    .update(payload)
    .eq('id', roleId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update role.');
  }

  return data;
}

export async function listEmployeeAccess(): Promise<EmployeeAccessRecord[]> {
  const supabase = createServerClient();

  const [{ data: students }, { data: assignments }, { data: roleTemplates }, { data: overrides }] =
    await Promise.all([
      supabase.from('students').select('id,name,s_number').order('name', { ascending: true }),
      supabase
        .from('employee_role_assignments')
        .select('employee_id,role_template_id,is_primary,created_at')
        .order('created_at', { ascending: true }),
      supabase.from('access_role_templates').select('id,role_key,role_name,is_active'),
      supabase
        .from('employee_permission_overrides')
        .select('employee_id,permission_key,effect')
        .order('created_at', { ascending: true })
    ]);

  const templatesById = new Map<string, { role_key: string; role_name: string; is_active: boolean }>();
  for (const row of (roleTemplates ?? []) as Array<Record<string, unknown>>) {
    templatesById.set(String(row.id), {
      role_key: String(row.role_key ?? ''),
      role_name: String(row.role_name ?? ''),
      is_active: Boolean(row.is_active)
    });
  }

  const primaryAssignmentByEmployeeId = new Map<string, { role_template_id: string }>();
  for (const row of (assignments ?? []) as Array<Record<string, unknown>>) {
    const employeeId = String(row.employee_id ?? '');
    if (!employeeId) continue;

    const roleTemplateId = String(row.role_template_id ?? '');
    if (!roleTemplateId) continue;

    const isPrimary = Boolean(row.is_primary);
    if (isPrimary || !primaryAssignmentByEmployeeId.has(employeeId)) {
      primaryAssignmentByEmployeeId.set(employeeId, { role_template_id: roleTemplateId });
    }
  }

  const overridesByEmployeeId = new Map<string, Array<{ permission_key: string; effect: 'allow' | 'deny' }>>();
  for (const row of (overrides ?? []) as Array<Record<string, unknown>>) {
    const employeeId = String(row.employee_id ?? '');
    if (!employeeId) continue;
    const bucket = overridesByEmployeeId.get(employeeId) ?? [];
    const effect = String(row.effect ?? '') === 'deny' ? 'deny' : 'allow';
    bucket.push({
      permission_key: String(row.permission_key ?? ''),
      effect
    });
    overridesByEmployeeId.set(employeeId, bucket);
  }

  const results: EmployeeAccessRecord[] = [];

  for (const student of (students ?? []) as Array<Record<string, unknown>>) {
    const employeeId = String(student.id ?? '');
    const assignment = primaryAssignmentByEmployeeId.get(employeeId) ?? null;
    const templateMeta = assignment ? templatesById.get(assignment.role_template_id) : null;

    const resolved = await resolveEffectivePermissions(employeeId);

    results.push({
      employee_id: employeeId,
      employee_name: String(student.name ?? ''),
      s_number: String(student.s_number ?? ''),
      role_template_id: assignment?.role_template_id ?? null,
      role_key: templateMeta?.role_key ?? null,
      role_name: templateMeta?.role_name ?? null,
      permissions: resolved.permissions,
      overrides: overridesByEmployeeId.get(employeeId) ?? []
    });
  }

  return results;
}

export async function updateEmployeeAccess(input: {
  employeeId: string;
  roleTemplateId?: string | null;
  overrides?: Array<{ permission_key: string; effect: 'allow' | 'deny' }>;
  assignedBy?: string;
}) {
  const supabase = createServerClient();

  if (typeof input.roleTemplateId === 'string' && input.roleTemplateId) {
    await supabase.from('employee_role_assignments').delete().eq('employee_id', input.employeeId);

    const { error: assignmentError } = await supabase.from('employee_role_assignments').insert({
      employee_id: input.employeeId,
      role_template_id: input.roleTemplateId,
      is_primary: true,
      assigned_by: input.assignedBy ?? 'access_control'
    });

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }
  }

  if (Array.isArray(input.overrides)) {
    await supabase.from('employee_permission_overrides').delete().eq('employee_id', input.employeeId);

    if (input.overrides.length > 0) {
      const { error: overrideError } = await supabase.from('employee_permission_overrides').insert(
        input.overrides.map((entry) => ({
          employee_id: input.employeeId,
          permission_key: entry.permission_key,
          effect: entry.effect
        }))
      );

      if (overrideError) {
        throw new Error(overrideError.message);
      }
    }
  }
}
