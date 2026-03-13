import { SupabaseClient } from '@supabase/supabase-js';

import { getServerAuthContext } from '@/lib/server/auth';

export type HourRequestStatus = 'pending' | 'approved' | 'denied';

type JsonRecord = Record<string, unknown>;

export interface HourRequestRow {
  id: string;
  employee_id: number;
  employee_s_number: string;
  hours_date: string;
  project_name: string;
  commitment_name: string | null;
  description: string;
  submitted_hours: number;
  approved_hours: number | null;
  status: HourRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HoursActor {
  employeeId: number;
  employeeSNumber: string;
  name: string;
}

function rowAsHourRequest(row: JsonRecord): HourRequestRow {
  return {
    id: String(row.id),
    employee_id: Number(row.employee_id),
    employee_s_number: String(row.employee_s_number),
    hours_date: String(row.hours_date),
    project_name: String(row.project_name ?? ''),
    commitment_name: row.commitment_name ? String(row.commitment_name) : null,
    description: String(row.description ?? ''),
    submitted_hours: Number(row.submitted_hours),
    approved_hours:
      row.approved_hours === null || row.approved_hours === undefined ? null : Number(row.approved_hours),
    status: String(row.status) as HourRequestStatus,
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    review_notes: row.review_notes ? String(row.review_notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export async function resolveHoursActor(): Promise<HoursActor | null> {
  const user = await getServerAuthContext();
  if (!user) return null;

  const employeeId = Number(user.employeeId);
  const employeeSNumber = String(user.sNumber ?? '').trim();
  if (!Number.isFinite(employeeId) || employeeId <= 0 || !employeeSNumber) {
    return null;
  }

  return {
    employeeId,
    employeeSNumber,
    name: String(user.name ?? employeeSNumber)
  };
}

export async function listHourRequestsForEmployee(
  supabase: SupabaseClient,
  employeeId: number
): Promise<HourRequestRow[]> {
  const { data, error } = await supabase
    .from('executive_hour_submissions')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return ((data ?? []) as JsonRecord[]).map(rowAsHourRequest);
}

export async function createHourRequest(
  supabase: SupabaseClient,
  input: {
    employee_id: number;
    employee_s_number: string;
    hours_date: string;
    project_name: string;
    commitment_name?: string | null;
    description: string;
    submitted_hours: number;
  }
): Promise<HourRequestRow> {
  const { data, error } = await supabase
    .from('executive_hour_submissions')
    .insert({
      employee_id: input.employee_id,
      employee_s_number: input.employee_s_number,
      hours_date: input.hours_date,
      project_name: input.project_name,
      commitment_name: input.commitment_name ?? null,
      description: input.description,
      submitted_hours: input.submitted_hours,
      status: 'pending'
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Unable to submit hours request');
  return rowAsHourRequest(data as JsonRecord);
}

export async function listHourRequestsForExecutive(
  supabase: SupabaseClient,
  options?: {
    status?: 'pending' | 'approved' | 'denied' | 'all';
    from?: string;
    to?: string;
    employeeSNumber?: string;
    project?: string;
  }
): Promise<HourRequestRow[]> {
  let query = supabase
    .from('executive_hour_submissions')
    .select('*')
    .order('hours_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);

  if (options?.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }
  if (options?.from) {
    query = query.gte('hours_date', options.from);
  }
  if (options?.to) {
    query = query.lte('hours_date', options.to);
  }
  if (options?.employeeSNumber) {
    query = query.ilike('employee_s_number', `%${options.employeeSNumber.trim()}%`);
  }
  if (options?.project) {
    query = query.ilike('project_name', `%${options.project.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as JsonRecord[]).map(rowAsHourRequest);
}

export async function reviewHourRequest(
  supabase: SupabaseClient,
  input: {
    requestId: string;
    status: 'approved' | 'denied';
    actor: string;
    approvedHours?: number | null;
    reviewNotes?: string | null;
  }
): Promise<HourRequestRow> {
  const { data: existing, error: existingError } = await supabase
    .from('executive_hour_submissions')
    .select('*')
    .eq('id', input.requestId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error('Hours request not found.');
  if (String((existing as JsonRecord).status) !== 'pending') {
    throw new Error('Hours request has already been reviewed.');
  }

  const submittedHours = Number((existing as JsonRecord).submitted_hours);
  const resolvedApprovedHours =
    input.status === 'approved'
      ? Number.isFinite(Number(input.approvedHours))
        ? Number(input.approvedHours)
        : submittedHours
      : null;

  const { data: updated, error: updateError } = await supabase
    .from('executive_hour_submissions')
    .update({
      status: input.status,
      approved_hours: resolvedApprovedHours,
      reviewed_by: input.actor,
      reviewed_at: new Date().toISOString(),
      review_notes: input.reviewNotes ?? null
    })
    .eq('id', input.requestId)
    .select('*')
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message ?? 'Unable to review hours request');
  }

  return rowAsHourRequest(updated as JsonRecord);
}

export async function logHourAudit(
  supabase: SupabaseClient,
  input: {
    actor: string;
    action: string;
    recordId: string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { error } = await supabase.from('hr_audit_log').insert({
    user_id: input.actor,
    action: input.action,
    table_name: 'executive_hour_submissions',
    record_id: input.recordId,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}
