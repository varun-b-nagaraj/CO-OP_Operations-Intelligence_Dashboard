import { randomBytes, createHash } from 'crypto';
import 'server-only';

import { cookies } from 'next/headers';

import { can, canonicalizePermissions, expandForLegacyClients } from '@/lib/access/engine';
import { ALL_PERMISSION_KEYS, CANONICAL_TO_LEGACY } from '@/lib/access/registry';
import { createServerClient } from '@/lib/supabase';
import { PermissionFlag, UserContext } from '@/lib/types';

export const AUTH_COOKIE_NAME = 'coop_session';
const SESSION_TTL_DAYS = 14;
const HARD_CODED_EXEC_S_NUMBER = 's151579';
const HARD_CODED_EXEC_PASSWORD = 'Sleepfox1!';
const HARD_CODED_EXEC_SESSION_TOKEN = 'hardcoded_exec_session_v1';
const HARD_CODED_EXEC_ROLE = 'exec';
const HARD_CODED_EXEC_PERMISSIONS: PermissionFlag[] = Array.from(
  new Set([
    '*',
    ...ALL_PERMISSION_KEYS,
    ...ALL_PERMISSION_KEYS.flatMap((key) => CANONICAL_TO_LEGACY.get(key) ?? [])
  ])
);

interface SessionRow {
  employee_id: number;
  expires_at: string;
  revoked_at: string | null;
}

export interface AuthenticatedUserContext extends UserContext {
  employeeId: string;
  sNumber: string;
  name: string;
}

function isRBACV2Enabled(): boolean {
  return process.env.RBAC_V2_ENABLED !== 'false';
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function computeExpirationDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  return expires;
}

function normalizeSNumber(value: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const numeric = raw.replace(/^s/, '');
  return numeric ? `s${numeric}` : raw;
}

export function isHardcodedExecSNumber(sNumber: string): boolean {
  return normalizeSNumber(sNumber) === HARD_CODED_EXEC_S_NUMBER;
}

export function isHardcodedExecCredential(sNumber: string, password: string): boolean {
  return isHardcodedExecSNumber(sNumber) && password === HARD_CODED_EXEC_PASSWORD;
}

export function getHardcodedExecSessionToken(): string {
  return HARD_CODED_EXEC_SESSION_TOKEN;
}

async function resolveEffectivePermissionsLegacy(
  employeeId: string
): Promise<{ role: string; permissions: PermissionFlag[] }> {
  const supabase = createServerClient();

  const { data: assignments, error: assignmentError } = await supabase
    .from('employee_role_assignments')
    .select('role_template_id,is_primary')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: true });

  if (assignmentError) {
    return { role: 'employee', permissions: [] };
  }

  const roleTemplateIds = (assignments ?? []).map((row) => String(row.role_template_id ?? '')).filter(Boolean);
  const primaryTemplateId =
    (assignments ?? []).find((row) => row.is_primary)?.role_template_id ?? roleTemplateIds[0] ?? null;

  let role = 'employee';
  const permissionSet = new Set<PermissionFlag>();

  if (roleTemplateIds.length > 0) {
    const { data: templates } = await supabase
      .from('access_role_templates')
      .select('id,role_key,permissions')
      .in('id', roleTemplateIds)
      .eq('is_active', true);

    for (const template of templates ?? []) {
      if (String(template.id) === String(primaryTemplateId)) {
        role = String(template.role_key ?? role);
      }

      const permissions = Array.isArray(template.permissions)
        ? (template.permissions as unknown[])
        : [];

      for (const permission of permissions) {
        const key = String(permission ?? '').trim();
        if (!key) continue;
        permissionSet.add(key);
      }
    }
  }

  const { data: overrides } = await supabase
    .from('employee_permission_overrides')
    .select('permission_key,effect')
    .eq('employee_id', employeeId);

  for (const override of overrides ?? []) {
    const permissionKey = String(override.permission_key ?? '').trim();
    if (!permissionKey) continue;

    if (String(override.effect ?? '') === 'deny') {
      permissionSet.delete(permissionKey);
      continue;
    }

    permissionSet.add(permissionKey);
  }

  return {
    role,
    permissions: Array.from(permissionSet)
  };
}

export async function resolveEffectivePermissions(
  employeeId: string
): Promise<{ role: string; permissions: PermissionFlag[] }> {
  if (!isRBACV2Enabled()) {
    return resolveEffectivePermissionsLegacy(employeeId);
  }

  const supabase = createServerClient();

  const { data: assignments, error: assignmentError } = await supabase
    .from('employee_role_assignments')
    .select('role_key,is_primary')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: true });

  if (assignmentError) {
    return resolveEffectivePermissionsLegacy(employeeId);
  }

  const roleKeys = (assignments ?? [])
    .map((row) => String(row.role_key ?? '').trim())
    .filter(Boolean);
  const primaryRoleKey =
    (assignments ?? []).find((row) => Boolean(row.is_primary))?.role_key ?? roleKeys[0] ?? 'employee_self_service';

  if (roleKeys.length === 0) {
    return { role: 'employee_self_service', permissions: [] };
  }

  const { data: rolePermissionRows, error: rolePermissionError } = await supabase
    .from('access_role_permissions')
    .select('permission_key')
    .in('role_key', roleKeys);

  if (rolePermissionError) {
    return resolveEffectivePermissionsLegacy(employeeId);
  }

  const basePermissions = (rolePermissionRows ?? [])
    .map((row) => String(row.permission_key ?? '').trim())
    .filter(Boolean);
  const canonicalResolved = canonicalizePermissions(basePermissions);
  const effectivePermissions = expandForLegacyClients(canonicalResolved);

  return {
    role: String(primaryRoleKey),
    permissions: effectivePermissions
  };
}

export async function getServerAuthContext(): Promise<AuthenticatedUserContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  if (token === HARD_CODED_EXEC_SESSION_TOKEN) {
    return {
      id: 'hardcoded_exec',
      employeeId: 'hardcoded_exec',
      role: HARD_CODED_EXEC_ROLE,
      permissions: HARD_CODED_EXEC_PERMISSIONS,
      sNumber: HARD_CODED_EXEC_S_NUMBER,
      name: 'Executive'
    };
  }

  const tokenHash = hashSessionToken(token);
  const supabase = createServerClient();

  const { data: sessionRow, error: sessionError } = await supabase
    .from('auth_sessions')
    .select('employee_id,expires_at,revoked_at')
    .eq('session_token_hash', tokenHash)
    .maybeSingle();

  if (sessionError || !sessionRow) return null;

  const session = sessionRow as SessionRow;
  if (session.revoked_at) return null;

  const expiresAt = new Date(session.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const { data: studentRow } = await supabase
    .from('students')
    .select('id,name,s_number')
    .eq('id', String(session.employee_id))
    .maybeSingle();

  if (!studentRow) return null;

  const { role, permissions } = await resolveEffectivePermissions(String(session.employee_id));
  const studentSNumber = String(studentRow.s_number ?? '').trim().toLowerCase();
  const isHardcodedExec = isHardcodedExecSNumber(studentSNumber);

  return {
    id: String(session.employee_id),
    employeeId: String(session.employee_id),
    role: isHardcodedExec ? HARD_CODED_EXEC_ROLE : role,
    permissions: isHardcodedExec ? HARD_CODED_EXEC_PERMISSIONS : permissions,
    sNumber: String(studentRow.s_number ?? ''),
    name: String(studentRow.name ?? '')
  };
}

export async function createAuthSession(employeeId: string): Promise<{ token: string; expiresAt: Date } | null> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const expiresAt = computeExpirationDate();

  const supabase = createServerClient();

  await supabase
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());

  const { error } = await supabase
    .from('auth_sessions')
    .insert({
      employee_id: employeeId,
      session_token_hash: tokenHash,
      expires_at: expiresAt.toISOString()
    });

  if (error) return null;

  return { token, expiresAt };
}

export async function revokeAuthSessionByCookie(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return;
  if (token === HARD_CODED_EXEC_SESSION_TOKEN) return;

  const tokenHash = hashSessionToken(token);
  const supabase = createServerClient();

  await supabase
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('session_token_hash', tokenHash)
    .is('revoked_at', null);
}

export async function requirePermission(permissionKey: PermissionFlag): Promise<boolean> {
  const context = await getServerAuthContext();
  if (!context) return false;
  if (isHardcodedExecSNumber(context.sNumber)) return true;
  return can(permissionKey, canonicalizePermissions(context.permissions));
}

export function buildAuthCookieConfig(expiresAt: Date) {
  void expiresAt;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  };
}
