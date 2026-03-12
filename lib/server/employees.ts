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
      (typeof row.student_number === 'string' && row.student_number) ||
      (typeof row.snumber === 'string' && row.snumber) ||
      '',
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
  const raw = String(sNumber ?? '').trim();
  if (!raw) return null;

  const withoutPrefix = raw.replace(/^s/i, '');
  const candidates = Array.from(
    new Set(
      [
        raw,
        raw.toLowerCase(),
        raw.toUpperCase(),
        withoutPrefix,
        `s${withoutPrefix}`,
        `S${withoutPrefix}`
      ].filter(Boolean)
    )
  );

  const orFilters = candidates.flatMap((value) => [
    `s_number.eq.${value}`,
    `student_number.eq.${value}`,
    `snumber.eq.${value}`
  ]);

  const { data, error } = await supabase
    .from('students')
    .select('*')
    .or(orFilters.join(','))
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeStudentRow(data as Record<string, unknown>);
}
