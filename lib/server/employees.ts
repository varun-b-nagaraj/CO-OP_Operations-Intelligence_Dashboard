import { SupabaseClient } from '@supabase/supabase-js';

import { Employee } from '@/lib/types';

function normalizeStudentRow(row: Record<string, unknown>): Employee {
  return {
    id: String(row.id),
    name:
      (typeof row.name === 'string' && row.name) ||
      (typeof row.full_name === 'string' && row.full_name) ||
      (typeof row.student_name === 'string' && row.student_name) ||
      'Unknown',
    s_number:
      (typeof row.s_number === 'string' && row.s_number) ||
      (typeof row.snumber === 'string' && row.snumber) ||
      '',
    username: typeof row.username === 'string' ? row.username : null,
    assigned_periods:
      typeof row.assigned_periods === 'string'
        ? row.assigned_periods
        : typeof row.Schedule === 'number'
          ? String(row.Schedule)
          : null
  };
}

export async function getStudentById(
  supabase: SupabaseClient,
  employeeId: string
): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeStudentRow(data as Record<string, unknown>);
}

export async function getStudentBySNumber(
  supabase: SupabaseClient,
  sNumber: string
): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('s_number', sNumber)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeStudentRow(data as Record<string, unknown>);
}
