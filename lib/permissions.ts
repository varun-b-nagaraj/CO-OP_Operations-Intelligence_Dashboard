import { PermissionFlag, UserContext } from '@/lib/types';

const V1_OPEN_ACCESS = true;

export function getCurrentUser(): UserContext {
  return {
    id: null,
    role: null,
    permissions: []
  };
}

export function hasPermission(flag: PermissionFlag): boolean {
  void flag;
  if (V1_OPEN_ACCESS) return true;
  const user = getCurrentUser();
  return user.permissions.includes(flag);
}

export function usePermission(flag: PermissionFlag): boolean {
  return hasPermission(flag);
}

export async function ensureServerPermission(flag: PermissionFlag): Promise<boolean> {
  void flag;
  if (V1_OPEN_ACCESS) return true;
  return false;
}
