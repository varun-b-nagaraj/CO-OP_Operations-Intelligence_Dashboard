import 'server-only';

import { requirePermission } from '@/lib/server/auth';
import { PermissionFlag } from '@/lib/types';

export async function ensureServerPermission(flag: PermissionFlag): Promise<boolean> {
  return requirePermission(flag);
}
