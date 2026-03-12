import 'server-only';

import { getServerAuthContext } from '@/lib/server/auth';
import { createServerClient } from '@/lib/supabase';

export interface InventoryActor {
  employeeId: number;
  employeeSNumber: string;
}

export async function resolveInventoryActor(): Promise<InventoryActor | null> {
  const user = await getServerAuthContext();
  if (!user) return null;

  const directEmployeeId = Number(user.employeeId);
  const directSNumber = String(user.sNumber ?? '').trim();
  if (Number.isFinite(directEmployeeId) && directEmployeeId > 0 && directSNumber) {
    return {
      employeeId: directEmployeeId,
      employeeSNumber: directSNumber
    };
  }

  if (!directSNumber) return null;

  const supabase = createServerClient();
  const { data } = await supabase
    .from('students')
    .select('id,s_number')
    .ilike('s_number', directSNumber)
    .maybeSingle();

  if (!data?.id) return null;

  return {
    employeeId: Number(data.id),
    employeeSNumber: String(data.s_number ?? directSNumber).trim() || directSNumber
  };
}
