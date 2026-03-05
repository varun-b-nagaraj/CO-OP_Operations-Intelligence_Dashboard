import { NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';

import { errorResult, generateCorrelationId, Result } from '@/lib/types';

export function getCorrelationId(headerValue?: string | null): string {
  return headerValue?.trim() || generateCorrelationId();
}

export function logInfo(message: string, details: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: 'info', message, ...details }));
}

export function logError(message: string, details: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: 'error', message, ...details }));
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '42P01' || /does not exist/i.test(maybeError.message ?? '');
}

export async function resolvePreferredTable(
  supabase: SupabaseClient,
  preferredTable: string,
  fallbackTable: string,
  probeColumn = 'id'
): Promise<string> {
  const preferredProbe = await supabase
    .from(preferredTable)
    .select(probeColumn, { head: true, count: 'exact' })
    .limit(1);
  if (!preferredProbe.error) {
    return preferredTable;
  }
  if (!isMissingRelationError(preferredProbe.error)) {
    throw new Error(preferredProbe.error.message);
  }

  const fallbackProbe = await supabase
    .from(fallbackTable)
    .select(probeColumn, { head: true, count: 'exact' })
    .limit(1);
  if (!fallbackProbe.error) {
    return fallbackTable;
  }
  throw new Error(fallbackProbe.error.message);
}

export function jsonResult<T>(result: Result<T>, status = 200): NextResponse<Result<T>> {
  return NextResponse.json(result, { status });
}

export function jsonValidationError(
  correlationId: string,
  message: string,
  fieldErrors?: Record<string, string>
): NextResponse<Result<never>> {
  return jsonResult(errorResult(correlationId, 'VALIDATION_ERROR', message, fieldErrors), 400);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  correlationId: string,
  label: string,
  maxAttempts = 3
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logError(`${label}_attempt_failed`, {
        correlationId,
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });
      if (attempt >= maxAttempts) break;
      const delay = 100 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operation failed');
}
