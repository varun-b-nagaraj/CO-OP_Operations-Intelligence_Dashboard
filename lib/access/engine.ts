import {
  BASELINE_ROLES,
  HOME_NAV_SECTIONS,
  LEGACY_TO_CANONICAL,
  PERMISSION_BY_KEY
} from '@/lib/access/registry';
import { NavSectionDefinition, PermissionKey, VisibleNavSection } from '@/lib/access/types';

const GLOBAL_WILDCARD = '*' as PermissionKey;

function normalizePermissionKey(permission: string): PermissionKey | null {
  const trimmed = String(permission ?? '').trim();
  if (!trimmed) return null;
  if (trimmed === GLOBAL_WILDCARD) return GLOBAL_WILDCARD;
  const canonical = LEGACY_TO_CANONICAL.get(trimmed);
  return (canonical ?? trimmed) as PermissionKey;
}

function parsePermission(permission: string): {
  base: string;
  action: string;
  scope: string | null;
} | null {
  const canonical = normalizePermissionKey(permission);
  if (!canonical || canonical === GLOBAL_WILDCARD) return null;
  const [base, action, scope] = canonical.split(':');
  if (!base || !action) return null;
  return { base, action, scope: scope ?? null };
}

function impliedPermissionKeys(permission: PermissionKey): PermissionKey[] {
  if (permission === GLOBAL_WILDCARD) return [permission];

  const parsed = parsePermission(permission);
  if (!parsed) return [permission];
  const { base, action, scope } = parsed;

  const implied = new Set<PermissionKey>([permission]);
  if (action === 'edit' && scope === 'all') {
    implied.add(`${base}:view:all` as PermissionKey);
    implied.add(`${base}:view:own` as PermissionKey);
  }

  return Array.from(implied);
}

export function canonicalizePermissions(rawPermissions: string[]): Set<PermissionKey> {
  const set = new Set<PermissionKey>();
  for (const permission of rawPermissions) {
    const normalized = normalizePermissionKey(permission);
    if (!normalized) continue;
    for (const implied of impliedPermissionKeys(normalized)) {
      set.add(implied);
    }
  }
  return set;
}

export function resolvePermissions(roleKeys: string[]): Set<PermissionKey> {
  const set = new Set<PermissionKey>();
  for (const roleKey of roleKeys) {
    const role = BASELINE_ROLES.find((candidate) => candidate.roleKey === roleKey);
    if (!role) continue;
    for (const permission of role.permissions) {
      const normalized = normalizePermissionKey(permission);
      if (!normalized) continue;
      for (const implied of impliedPermissionKeys(normalized)) {
        set.add(implied);
      }
    }
  }
  return set;
}

export function can(permission: string, resolved: Set<PermissionKey>): boolean {
  if (resolved.has(GLOBAL_WILDCARD)) return true;
  const normalized = normalizePermissionKey(permission);
  if (!normalized) return false;
  if (resolved.has(normalized)) return true;

  const parsed = parsePermission(normalized);
  if (!parsed) return false;

  if (parsed.action === 'view' && parsed.scope === 'own') {
    return resolved.has(`${parsed.base}:view:all` as PermissionKey);
  }

  return false;
}

export function canAny(prefix: string, action: string, resolved: Set<PermissionKey>): boolean {
  if (resolved.has(GLOBAL_WILDCARD)) return true;
  const candidatePrefix = `${prefix}:${action}`;
  for (const permission of resolved) {
    if (permission === GLOBAL_WILDCARD) return true;
    if (permission === candidatePrefix) return true;
    if (permission.startsWith(`${candidatePrefix}:`)) return true;
  }
  return false;
}

export function buildVisibleNav(
  config: NavSectionDefinition[] = HOME_NAV_SECTIONS,
  resolved: Set<PermissionKey>
): VisibleNavSection[] {
  return config
    .map((section) => ({
      id: section.id,
      label: section.label,
      children: section.children.filter((child) => can(child.permission, resolved))
    }))
    .filter((section) => section.children.length > 0);
}

export function expandForLegacyClients(resolved: Set<PermissionKey>): string[] {
  const expanded = new Set<string>();
  for (const permission of resolved) {
    expanded.add(permission);
    const definition = PERMISSION_BY_KEY.get(permission);
    for (const alias of definition?.legacyAliases ?? []) {
      expanded.add(alias);
    }
  }
  return Array.from(expanded);
}
