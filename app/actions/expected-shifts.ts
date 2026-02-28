'use server';

import { z } from 'zod';

import { ensureServerPermission } from '@/lib/permissions';
import { buildExpectedShiftsInternal } from '@/lib/server/expected-shifts';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import { errorResult, generateCorrelationId, Result } from '@/lib/types';

const BuildExpectedSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  forceRebuild: z.boolean().optional(),
  anchorDate: z.string().optional(),
  anchorDay: z.enum(['A', 'B']).optional(),
  seed: z.number().int().optional()
});

type BuildOptions = {
  forceRebuild?: boolean;
  anchorDate?: string;
  anchorDay?: 'A' | 'B';
  seed?: number;
};

export async function buildExpectedShifts(
  year: number,
  month: number,
  options: BuildOptions = {}
): Promise<Result<{ created: number; updated: number }>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.schedule.edit');
    if (!allowed) {
      return errorResult(
        correlationId,
        'FORBIDDEN',
        'You do not have permission to build expected shifts.'
      );
    }

    const parsed = BuildExpectedSchema.safeParse({
      year,
      month,
      forceRebuild: options.forceRebuild,
      anchorDate: options.anchorDate,
      anchorDay: options.anchorDay,
      seed: options.seed
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.reduce<Record<string, string>>((acc, issue) => {
        acc[issue.path.join('.') || 'root'] = issue.message;
        return acc;
      }, {});
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Invalid build expected shifts input', fieldErrors);
    }

    const now = new Date();
    const defaultAnchorDate = now.toISOString().slice(0, 10);
    const defaultSeed = Number(`${parsed.data.year}${String(parsed.data.month).padStart(2, '0')}`);

    const supabase = createServerClient();
    const result = await buildExpectedShiftsInternal(
      supabase,
      {
        year: parsed.data.year,
        month: parsed.data.month,
        anchorDate: parsed.data.anchorDate ?? defaultAnchorDate,
        anchorDay: parsed.data.anchorDay ?? 'A',
        seed: parsed.data.seed ?? defaultSeed,
        forceRebuild: parsed.data.forceRebuild
      },
      correlationId
    );

    if (result.ok) {
      logInfo('expected_shifts_built', {
        correlationId,
        year: parsed.data.year,
        month: parsed.data.month,
        created: result.data.created,
        updated: result.data.updated
      });
    }

    return result;
  } catch (error) {
    logError('build_expected_shifts_action_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to build expected shifts.');
  }
}
