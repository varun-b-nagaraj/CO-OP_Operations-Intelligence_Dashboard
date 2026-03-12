import { SupabaseClient } from '@supabase/supabase-js';

import {
  InventoryCheck,
  InventoryCheckAnalytics,
  InventoryCheckAttendanceStatus,
  InventoryCheckChangeRequest,
  InventoryCheckRequestStatus,
  InventoryCheckRequestType,
  InventoryCheckSignup
} from '@/lib/types';

type JsonRecord = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function parseDateMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function normalizeCalendarPriority(value: unknown): 'employee' | 'director' | 'executive' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'executive' || normalized === 'exec') return 'executive';
  if (normalized === 'director' || normalized === 'department_manager' || normalized === 'all_managers') {
    return 'director';
  }
  return 'employee';
}

function rowAsInventoryCheck(row: JsonRecord, event?: JsonRecord | null): InventoryCheck {
  return {
    id: String(row.id),
    calendar_event_id: String(row.calendar_event_id),
    check_date: String(row.check_date),
    starts_at: String(row.starts_at),
    ends_at: row.ends_at ? String(row.ends_at) : null,
    location: row.location ? String(row.location) : null,
    notes: row.notes ? String(row.notes) : null,
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    title: event?.title ? String(event.title) : undefined,
    details: event?.details ? String(event.details) : null,
    source_department: event?.source_department ? String(event.source_department) : null
  };
}

function rowAsSignup(row: JsonRecord): InventoryCheckSignup {
  return {
    id: String(row.id),
    inventory_check_id: String(row.inventory_check_id),
    employee_id: Number(row.employee_id),
    employee_s_number: String(row.employee_s_number),
    signup_status: String(row.signup_status) as InventoryCheckSignup['signup_status'],
    attendance_status: String(row.attendance_status) as InventoryCheckAttendanceStatus,
    attendance_reason: row.attendance_reason ? String(row.attendance_reason) : null,
    marked_by: row.marked_by ? String(row.marked_by) : null,
    marked_at: row.marked_at ? String(row.marked_at) : null,
    signed_up_at: String(row.signed_up_at),
    updated_at: String(row.updated_at)
  };
}

function rowAsRequest(row: JsonRecord): InventoryCheckChangeRequest {
  return {
    id: String(row.id),
    inventory_check_id: String(row.inventory_check_id),
    employee_id: Number(row.employee_id),
    employee_s_number: String(row.employee_s_number),
    request_type: String(row.request_type) as InventoryCheckRequestType,
    reason: String(row.reason),
    status: String(row.status) as InventoryCheckRequestStatus,
    requested_at: String(row.requested_at),
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null
  };
}

export async function createInventoryCheck(
  supabase: SupabaseClient,
  input: {
    title: string;
    details?: string | null;
    starts_at: string;
    ends_at?: string | null;
    priority?: 'employee' | 'director' | 'executive';
    source_department?: string | null;
    location?: string | null;
    notes?: string | null;
    capacity?: number | null;
    created_by?: string | null;
  }
): Promise<InventoryCheck> {
  const startsAt = new Date(input.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error('Invalid starts_at');
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('general_department_calendar_events')
    .insert({
      title: input.title,
      details: input.details ?? null,
      entry_type: 'event',
      starts_at: input.starts_at,
      ends_at: input.ends_at ?? null,
      priority: normalizeCalendarPriority(input.priority),
      source_department: input.source_department ?? 'inventory',
      created_by: input.created_by ?? 'open_access'
    })
    .select('*')
    .single();

  if (eventError || !eventRow) {
    throw new Error(eventError?.message ?? 'Unable to create calendar event');
  }

  const { data: checkRow, error: checkError } = await supabase
    .from('inventory_checks')
    .insert({
      calendar_event_id: eventRow.id,
      check_date: dateOnly(input.starts_at),
      starts_at: input.starts_at,
      ends_at: input.ends_at ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      capacity: input.capacity ?? null,
      created_by: input.created_by ?? 'open_access'
    })
    .select('*')
    .single();

  if (checkError || !checkRow) {
    await supabase.from('general_department_calendar_events').delete().eq('id', eventRow.id);
    throw new Error(checkError?.message ?? 'Unable to create inventory check');
  }

  return rowAsInventoryCheck(checkRow as JsonRecord, eventRow as JsonRecord);
}

export async function listInventoryChecks(
  supabase: SupabaseClient,
  options?: { from?: string; to?: string; limit?: number }
): Promise<InventoryCheck[]> {
  let query = supabase.from('inventory_checks').select('*').order('starts_at', { ascending: true });
  if (options?.from) query = query.gte('starts_at', options.from);
  if (options?.to) query = query.lte('starts_at', options.to);
  query = query.limit(options?.limit ?? 200);

  const { data: checks, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (checks ?? []) as JsonRecord[];
  if (rows.length === 0) return [];

  const eventIds = rows.map((row) => String(row.calendar_event_id));
  const { data: events, error: eventsError } = await supabase
    .from('general_department_calendar_events')
    .select('id,title,details,source_department')
    .in('id', eventIds);
  if (eventsError) throw new Error(eventsError.message);

  const eventById = new Map<string, JsonRecord>();
  for (const event of (events ?? []) as JsonRecord[]) {
    eventById.set(String(event.id), event);
  }

  return rows.map((row) => rowAsInventoryCheck(row, eventById.get(String(row.calendar_event_id)) ?? null));
}

export async function getInventoryCheckById(
  supabase: SupabaseClient,
  checkId: string
): Promise<InventoryCheck | null> {
  const { data: check, error } = await supabase
    .from('inventory_checks')
    .select('*')
    .eq('id', checkId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!check) return null;

  const { data: event } = await supabase
    .from('general_department_calendar_events')
    .select('id,title,details,source_department')
    .eq('id', String((check as JsonRecord).calendar_event_id))
    .maybeSingle();

  return rowAsInventoryCheck(check as JsonRecord, (event as JsonRecord | null) ?? null);
}

export async function getCheckRoster(
  supabase: SupabaseClient,
  checkId: string
): Promise<InventoryCheckSignup[]> {
  const { data, error } = await supabase
    .from('inventory_check_signups')
    .select('*')
    .eq('inventory_check_id', checkId)
    .order('signed_up_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as JsonRecord[]).map(rowAsSignup);
}

export async function getCheckRequests(
  supabase: SupabaseClient,
  checkId: string
): Promise<InventoryCheckChangeRequest[]> {
  const { data, error } = await supabase
    .from('inventory_check_change_requests')
    .select('*')
    .eq('inventory_check_id', checkId)
    .order('requested_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as JsonRecord[]).map(rowAsRequest);
}

export async function upsertSignup(
  supabase: SupabaseClient,
  input: {
    inventory_check_id: string;
    employee_id: number;
    employee_s_number: string;
    signup_status: 'signed_up' | 'withdrawn';
    actor?: string;
  }
): Promise<InventoryCheckSignup> {
  const row = {
    inventory_check_id: input.inventory_check_id,
    employee_id: input.employee_id,
    employee_s_number: input.employee_s_number,
    signup_status: input.signup_status,
    attendance_status: 'expected' as const,
    marked_by: input.actor ?? null,
    marked_at: nowIso()
  };
  const { data, error } = await supabase
    .from('inventory_check_signups')
    .upsert(row, { onConflict: 'inventory_check_id,employee_id' })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Unable to update signup');
  return rowAsSignup(data as JsonRecord);
}

export async function setAttendance(
  supabase: SupabaseClient,
  input: {
    inventory_check_id: string;
    employee_id: number;
    employee_s_number: string;
    attendance_status: InventoryCheckAttendanceStatus;
    attendance_reason?: string | null;
    actor?: string | null;
  }
): Promise<InventoryCheckSignup> {
  const { data, error } = await supabase
    .from('inventory_check_signups')
    .upsert(
      {
        inventory_check_id: input.inventory_check_id,
        employee_id: input.employee_id,
        employee_s_number: input.employee_s_number,
        signup_status: 'signed_up',
        attendance_status: input.attendance_status,
        attendance_reason: input.attendance_reason ?? null,
        marked_by: input.actor ?? null,
        marked_at: nowIso()
      },
      { onConflict: 'inventory_check_id,employee_id' }
    )
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Unable to set attendance');
  return rowAsSignup(data as JsonRecord);
}

export async function createChangeRequest(
  supabase: SupabaseClient,
  input: {
    inventory_check_id: string;
    employee_id: number;
    employee_s_number: string;
    request_type: InventoryCheckRequestType;
    reason: string;
  }
): Promise<InventoryCheckChangeRequest> {
  const { data, error } = await supabase
    .from('inventory_check_change_requests')
    .insert({
      inventory_check_id: input.inventory_check_id,
      employee_id: input.employee_id,
      employee_s_number: input.employee_s_number,
      request_type: input.request_type,
      reason: input.reason
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Unable to create request');
  return rowAsRequest(data as JsonRecord);
}

export async function reviewChangeRequest(
  supabase: SupabaseClient,
  input: {
    request_id: string;
    status: Exclude<InventoryCheckRequestStatus, 'pending'>;
    actor: string;
    excuseIfStarted?: boolean;
  }
): Promise<InventoryCheckChangeRequest> {
  const { data: requestRow, error: requestError } = await supabase
    .from('inventory_check_change_requests')
    .select('*')
    .eq('id', input.request_id)
    .single();
  if (requestError || !requestRow) throw new Error(requestError?.message ?? 'Request not found');

  const request = rowAsRequest(requestRow as JsonRecord);
  const now = nowIso();
  const { data: updated, error: updateError } = await supabase
    .from('inventory_check_change_requests')
    .update({ status: input.status, reviewed_by: input.actor, reviewed_at: now })
    .eq('id', request.id)
    .select('*')
    .single();
  if (updateError || !updated) throw new Error(updateError?.message ?? 'Unable to review request');

  if (input.status === 'approved') {
    const nextSignupStatus = request.request_type === 'add' ? 'signed_up' : 'withdrawn';
    await upsertSignup(supabase, {
      inventory_check_id: request.inventory_check_id,
      employee_id: request.employee_id,
      employee_s_number: request.employee_s_number,
      signup_status: nextSignupStatus,
      actor: input.actor
    });

    if (request.request_type === 'drop' && input.excuseIfStarted) {
      await setAttendance(supabase, {
        inventory_check_id: request.inventory_check_id,
        employee_id: request.employee_id,
        employee_s_number: request.employee_s_number,
        attendance_status: 'excused',
        attendance_reason: 'Approved late drop request',
        actor: input.actor
      });
    }
  }

  return rowAsRequest(updated as JsonRecord);
}

export async function logInventoryCheckAudit(
  supabase: SupabaseClient,
  input: {
    inventory_check_id: string;
    action: string;
    actor?: string | null;
    record_id?: string | null;
    old_value?: Record<string, unknown> | null;
    new_value?: Record<string, unknown> | null;
  }
): Promise<void> {
  const { error } = await supabase.from('inventory_check_audit_log').insert({
    inventory_check_id: input.inventory_check_id,
    action: input.action,
    actor: input.actor ?? null,
    record_id: input.record_id ?? null,
    old_value: input.old_value ?? null,
    new_value: input.new_value ?? null
  });
  if (error) throw new Error(error.message);
}

export function canSelfWithdraw(check: InventoryCheck): boolean {
  const startsAtMs = parseDateMs(check.starts_at);
  if (!Number.isFinite(startsAtMs)) return false;
  const cutoffMs = startsAtMs - 24 * 60 * 60 * 1000;
  return Date.now() < cutoffMs;
}

export function resolveAttendanceStatusForAnalytics(
  signup: InventoryCheckSignup,
  check: InventoryCheck
): InventoryCheckAttendanceStatus {
  if (signup.signup_status !== 'signed_up') return 'excused';
  if (signup.attendance_status !== 'expected') return signup.attendance_status;

  const endMs = parseDateMs(check.ends_at ?? check.starts_at);
  if (Number.isFinite(endMs) && Date.now() > endMs) return 'absent';
  return 'expected';
}

export async function computeInventoryAnalytics(
  supabase: SupabaseClient,
  options?: { from?: string; to?: string }
): Promise<InventoryCheckAnalytics> {
  const checks = await listInventoryChecks(supabase, {
    from: options?.from,
    to: options?.to,
    limit: 1000
  });
  if (!checks.length) {
    return {
      totalChecks: 0,
      totalSignups: 0,
      totalPresent: 0,
      totalAbsent: 0,
      totalExcused: 0,
      attendanceRate: 0,
      noShowRate: 0,
      excusedRate: 0,
      byCheck: []
    };
  }

  const checkIds = checks.map((check) => check.id);
  const { data: signupsRows, error } = await supabase
    .from('inventory_check_signups')
    .select('*')
    .in('inventory_check_id', checkIds);
  if (error) throw new Error(error.message);

  const signups = ((signupsRows ?? []) as JsonRecord[]).map(rowAsSignup);
  const signupsByCheck = new Map<string, InventoryCheckSignup[]>();
  for (const signup of signups) {
    const bucket = signupsByCheck.get(signup.inventory_check_id) ?? [];
    bucket.push(signup);
    signupsByCheck.set(signup.inventory_check_id, bucket);
  }

  let totalSignups = 0;
  let totalPresent = 0;
  let totalAbsent = 0;
  let totalExcused = 0;
  const byCheck: InventoryCheckAnalytics['byCheck'] = [];

  for (const check of checks) {
    const rows = signupsByCheck.get(check.id) ?? [];
    const activeRows = rows.filter((row) => row.signup_status === 'signed_up');
    let present = 0;
    let absent = 0;
    let excused = 0;
    for (const row of activeRows) {
      const status = resolveAttendanceStatusForAnalytics(row, check);
      if (status === 'present') present += 1;
      else if (status === 'absent') absent += 1;
      else if (status === 'excused') excused += 1;
    }

    const signupsCount = activeRows.length;
    totalSignups += signupsCount;
    totalPresent += present;
    totalAbsent += absent;
    totalExcused += excused;

    const attendanceRate = signupsCount > 0 ? (present / signupsCount) * 100 : 0;
    byCheck.push({
      inventory_check_id: check.id,
      title: check.title ?? 'Inventory Check',
      starts_at: check.starts_at,
      signups: signupsCount,
      present,
      absent,
      excused,
      attendanceRate
    });
  }

  const attendanceRate = totalSignups > 0 ? (totalPresent / totalSignups) * 100 : 0;
  const noShowRate = totalSignups > 0 ? (totalAbsent / totalSignups) * 100 : 0;
  const excusedRate = totalSignups > 0 ? (totalExcused / totalSignups) * 100 : 0;

  return {
    totalChecks: checks.length,
    totalSignups,
    totalPresent,
    totalAbsent,
    totalExcused,
    attendanceRate,
    noShowRate,
    excusedRate,
    byCheck
  };
}
