import {
  MeetingAttendanceParams,
  MeetingAttendanceResponse,
  NormalizedScheduleResponse,
  Result,
  ScheduleParams
} from '@/lib/types';

async function fetchResult<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });

  const payload = (await response.json()) as Result<T>;
  if (!response.ok && payload.ok) {
    return {
      ok: false,
      correlationId: payload.correlationId,
      error: {
        code: 'UNKNOWN_ERROR',
        message: `Request failed with ${response.status}`
      }
    };
  }

  return payload;
}

export async function fetchSchedule(
  params: ScheduleParams
): Promise<Result<NormalizedScheduleResponse>> {
  const query = new URLSearchParams({
    year: String(params.year),
    month: String(params.month),
    anchorDate: params.anchorDate,
    anchorDay: params.anchorDay,
    seed: String(params.seed)
  });

  if (params.forceRefresh) query.set('forceRefresh', '1');
  if (params.forceRebuildExpectedShifts) query.set('forceRebuildExpectedShifts', '1');

  return fetchResult<NormalizedScheduleResponse>(`/api/schedule-proxy?${query.toString()}`);
}

export async function fetchMeetingAttendance(
  params: MeetingAttendanceParams
): Promise<Result<MeetingAttendanceResponse>> {
  const query = new URLSearchParams();
  if (params.date) query.set('date', params.date);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.exclude) query.set('exclude', params.exclude);

  const url = query.toString()
    ? `/api/meeting-attendance-proxy?${query.toString()}`
    : '/api/meeting-attendance-proxy';

  return fetchResult<MeetingAttendanceResponse>(url);
}
