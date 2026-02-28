import { NextRequest } from 'next/server';

import { applyMeetingOverrides } from '@/lib/server/attendance';
import { getCorrelationId, jsonResult, jsonValidationError, logError, logInfo } from '@/lib/server/common';
import { fetchMeetingAttendanceFromApi } from '@/lib/server/external-apis';
import { AttendanceOverride, errorResult, successResult } from '@/lib/types';
import { MeetingAttendanceParamsSchema, zodFieldErrors } from '@/lib/validation';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request.headers.get('x-correlation-id'));

  try {
    const rawParams = {
      date: request.nextUrl.searchParams.get('date') ?? undefined,
      from: request.nextUrl.searchParams.get('from') ?? undefined,
      to: request.nextUrl.searchParams.get('to') ?? undefined,
      exclude: request.nextUrl.searchParams.get('exclude') ?? undefined
    };

    const parsed = MeetingAttendanceParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return jsonValidationError(
        correlationId,
        'Invalid meeting attendance parameters',
        zodFieldErrors(parsed.error)
      );
    }

    const meetingData = await fetchMeetingAttendanceFromApi(parsed.data, correlationId);
    const supabase = createServerClient();

    const from = parsed.data.date ?? parsed.data.from;
    const to = parsed.data.date ?? parsed.data.to ?? parsed.data.from;

    let query = supabase.from('attendance_overrides').select('*').eq('scope', 'meeting');
    if (from) query = query.gte('checkin_date', from);
    if (to) query = query.lte('checkin_date', to);

    const { data: overrides, error: overrideError } = await query;
    if (overrideError) {
      logError('meeting_override_query_failed', {
        correlationId,
        error: overrideError.message
      });
      return jsonResult(errorResult(correlationId, 'DB_ERROR', overrideError.message), 500);
    }

    const merged = applyMeetingOverrides(meetingData, (overrides ?? []) as AttendanceOverride[]);

    logInfo('meeting_proxy_success', {
      correlationId,
      sessions: merged.analytics.total_sessions,
      students: merged.analytics.total_students
    });

    return jsonResult(successResult(merged, correlationId), 200);
  } catch (error) {
    logError('meeting_proxy_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonResult(
      errorResult(
        correlationId,
        'EXTERNAL_API_ERROR',
        'Unable to fetch meeting attendance data. Please try again.'
      ),
      500
    );
  }
}
