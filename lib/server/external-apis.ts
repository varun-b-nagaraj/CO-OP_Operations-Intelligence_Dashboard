import { SupabaseClient } from '@supabase/supabase-js';

import { extractMeetingAttendanceRecords } from '@/lib/server/attendance';
import { logInfo, retryWithBackoff } from '@/lib/server/common';
import { normalizeScheduleResponse } from '@/lib/server/schedule';
import {
  MeetingAttendanceResponse,
  NormalizedScheduleResponse,
  ScheduleAPIResponse,
  ScheduleParams
} from '@/lib/types';
import { MeetingAttendanceApiResponseSchema, ScheduleApiResponseSchema } from '@/lib/validation';

function resolveApiUrl(rawValue: string | undefined, fallback: string, endpointPath: string): string {
  const candidate = (rawValue?.trim() || fallback).replace(/\/+$/, '');
  if (candidate.endsWith(endpointPath)) return candidate;
  return `${candidate}${endpointPath}`;
}

const SCHEDULE_API_URL = resolveApiUrl(
  process.env.SCHEDULING_API_URL,
  'https://scheduler-v2-gules.vercel.app/api/schedule',
  '/api/schedule'
);
const MEETING_API_URL = resolveApiUrl(
  process.env.MEETING_ATTENDANCE_API_URL,
  'https://hr-check-in-hnrx.vercel.app/api/report',
  '/api/report'
);

export async function fetchScheduleWithCache(
  supabase: SupabaseClient,
  params: ScheduleParams,
  correlationId: string
): Promise<{ schedule: NormalizedScheduleResponse; fromCache: boolean; generatedAt: string }> {
  if (!params.forceRefresh) {
    const { data: cached } = await supabase
      .from('schedules')
      .select('schedule_data, generated_at')
      .eq('year', params.year)
      .eq('month', params.month)
      .eq('anchor_date', params.anchorDate)
      .eq('anchor_day', params.anchorDay)
      .eq('seed', params.seed)
      .gte('generated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.schedule_data) {
      return {
        schedule: cached.schedule_data as NormalizedScheduleResponse,
        fromCache: true,
        generatedAt: cached.generated_at as string
      };
    }
  }

  const searchParams = new URLSearchParams({
    year: String(params.year),
    month: String(params.month),
    anchorDate: params.anchorDate,
    anchorDay: params.anchorDay,
    seed: String(params.seed)
  });

  const rawResponse = await retryWithBackoff(
    async () => {
      const response = await fetch(`${SCHEDULE_API_URL}?${searchParams.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(`Scheduling API failed with status ${response.status}`);
      }
      return response.json();
    },
    correlationId,
    'schedule_api_fetch'
  );

  const validated = ScheduleApiResponseSchema.parse(rawResponse) as ScheduleAPIResponse;
  const normalized = normalizeScheduleResponse(validated);
  const generatedAt = normalized.meta.generatedAt;

  await supabase.from('schedules').upsert(
    {
      year: params.year,
      month: params.month,
      anchor_date: params.anchorDate,
      anchor_day: params.anchorDay,
      seed: params.seed,
      schedule_data: normalized,
      generated_at: generatedAt
    },
    {
      onConflict: 'year,month,anchor_date,anchor_day,seed'
    }
  );

  logInfo('schedule_cached', {
    correlationId,
    year: params.year,
    month: params.month,
    anchorDate: params.anchorDate,
    anchorDay: params.anchorDay,
    seed: params.seed
  });

  return {
    schedule: normalized,
    fromCache: false,
    generatedAt
  };
}

export async function fetchMeetingAttendanceFromApi(
  query: { date?: string; from?: string; to?: string; exclude?: string },
  correlationId: string
): Promise<MeetingAttendanceResponse> {
  const params = new URLSearchParams();
  if (query.date) params.set('date', query.date);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.exclude) params.set('exclude', query.exclude);

  const responseJson = await retryWithBackoff(
    async () => {
      const response = await fetch(`${MEETING_API_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(`Meeting attendance API failed with status ${response.status}`);
      }
      return response.json();
    },
    correlationId,
    'meeting_api_fetch'
  );

  const validated = MeetingAttendanceApiResponseSchema.parse(responseJson);
  const records = extractMeetingAttendanceRecords(responseJson as Record<string, unknown>);

  return {
    ...validated,
    records
  };
}
