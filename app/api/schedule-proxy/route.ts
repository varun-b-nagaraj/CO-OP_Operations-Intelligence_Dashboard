import { NextRequest } from 'next/server';

import { buildExpectedShiftsInternal } from '@/lib/server/expected-shifts';
import { fetchScheduleWithCache } from '@/lib/server/external-apis';
import {
  getCorrelationId,
  jsonResult,
  jsonValidationError,
  logError,
  logInfo,
  resolvePreferredTable
} from '@/lib/server/common';
import { applyApprovedShiftExchanges, monthWindow } from '@/lib/server/schedule';
import { errorResult, ScheduleParams, ShiftChangeRequest, successResult } from '@/lib/types';
import { ScheduleParamsSchema, zodFieldErrors } from '@/lib/validation';
import { createServerClient } from '@/lib/supabase';

function buildDefaultScheduleParams(): ScheduleParams {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const anchorDate = now.toISOString().slice(0, 10);

  return {
    year,
    month,
    anchorDate,
    anchorDay: 'A',
    seed: Number(`${year}${String(month).padStart(2, '0')}`)
  };
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request.headers.get('x-correlation-id'));

  try {
    const defaults = buildDefaultScheduleParams();
    const rawParams = {
      year: Number(request.nextUrl.searchParams.get('year') ?? defaults.year),
      month: Number(request.nextUrl.searchParams.get('month') ?? defaults.month),
      anchorDate: request.nextUrl.searchParams.get('anchorDate') ?? defaults.anchorDate,
      anchorDay: (request.nextUrl.searchParams.get('anchorDay') ?? defaults.anchorDay) as 'A' | 'B',
      seed: Number(request.nextUrl.searchParams.get('seed') ?? defaults.seed),
      forceRefresh: request.nextUrl.searchParams.get('forceRefresh') === '1',
      forceRebuildExpectedShifts:
        request.nextUrl.searchParams.get('forceRebuildExpectedShifts') === '1'
    };

    const parsed = ScheduleParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return jsonValidationError(
        correlationId,
        'Invalid schedule parameters',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    let shiftChangeRequestTable: string | null = null;
    try {
      shiftChangeRequestTable = await resolvePreferredTable(
        supabase,
        'hr_shift_change_requests',
        'shift_change_requests',
        'id'
      );
    } catch (error) {
      logError('schedule_shift_change_table_resolution_failed', {
        correlationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const scheduleResult = await fetchScheduleWithCache(supabase, parsed.data, correlationId);
    const window = monthWindow(parsed.data.year, parsed.data.month);

    if (parsed.data.forceRefresh && shiftChangeRequestTable) {
      const { error: clearManagerEditsError } = await supabase
        .from(shiftChangeRequestTable)
        .delete()
        .eq('status', 'approved')
        .or(
          [
            'request_source.eq.manager_schedule',
            'reason.ilike.%Saved schedule edits%',
            'reason.ilike.%Assigned from schedule tab%',
            'reason.ilike.%Self-volunteered for shift%',
            'reason.ilike.%Self-removed from volunteered shift%'
          ].join(',')
        )
        .gte('shift_date', window.from)
        .lte('shift_date', window.to);

      if (clearManagerEditsError && !clearManagerEditsError.message.includes('request_source')) {
        logError('schedule_clear_manager_edits_failed', {
          correlationId,
          error: clearManagerEditsError.message
        });
      }
    }

    let approvedExchanges: ShiftChangeRequest[] = [];
    if (shiftChangeRequestTable) {
      const { data, error: exchangeError } = await supabase
        .from(shiftChangeRequestTable)
        .select('*')
        .eq('status', 'approved')
        .gte('shift_date', window.from)
        .lte('shift_date', window.to);

      if (exchangeError) {
        logError('schedule_exchange_overlay_failed', {
          correlationId,
          error: exchangeError.message
        });
      } else {
        approvedExchanges = (data ?? []) as ShiftChangeRequest[];
      }
    }

    const scheduleWithExchanges = applyApprovedShiftExchanges(
      scheduleResult.schedule,
      approvedExchanges
    );

    const shouldForceRebuild =
      parsed.data.forceRebuildExpectedShifts === true || parsed.data.forceRefresh === true;
    {
      const buildResult = await buildExpectedShiftsInternal(
        supabase,
        {
          year: parsed.data.year,
          month: parsed.data.month,
          anchorDate: parsed.data.anchorDate,
          anchorDay: parsed.data.anchorDay,
          seed: parsed.data.seed,
          forceRefresh: parsed.data.forceRefresh,
          forceRebuild: shouldForceRebuild
        },
        correlationId
      );

      if (!buildResult.ok) {
        logError('expected_shift_builder_failed', {
          correlationId,
          error: buildResult.error.message
        });
      }
    }

    logInfo('schedule_proxy_success', {
      correlationId,
      fromCache: scheduleResult.fromCache,
      generatedAt: scheduleResult.generatedAt,
      year: parsed.data.year,
      month: parsed.data.month
    });

    return jsonResult(successResult(scheduleWithExchanges, correlationId), 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('schedule_proxy_failed', {
      correlationId,
      error: errorMessage
    });
    return jsonResult(
      errorResult(
        correlationId,
        'EXTERNAL_API_ERROR',
        process.env.NODE_ENV === 'development'
          ? `Unable to fetch schedule data: ${errorMessage}`
          : 'Unable to fetch schedule data. Please try again.'
      ),
      500
    );
  }
}
