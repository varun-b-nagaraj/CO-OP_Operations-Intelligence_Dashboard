import { SupabaseClient } from '@supabase/supabase-js';

import { logError } from '@/lib/server/common';

const DEFAULT_USER_ID = 'open_access';

export async function insertAuditEntry(
  supabase: SupabaseClient,
  input: {
    action: string;
    tableName: string;
    recordId: string;
    oldValue: unknown;
    newValue: unknown;
    userId?: string | null;
  },
  correlationId: string
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    user_id: input.userId ?? DEFAULT_USER_ID,
    action: input.action,
    table_name: input.tableName,
    record_id: input.recordId,
    old_value: input.oldValue,
    new_value: input.newValue
  });

  if (error) {
    logError('audit_log_insert_failed', {
      correlationId,
      action: input.action,
      tableName: input.tableName,
      recordId: input.recordId,
      error: error.message
    });
  }
}
