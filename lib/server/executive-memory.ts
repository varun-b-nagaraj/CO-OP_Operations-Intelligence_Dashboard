import { createServerClient } from '@/lib/supabase';

export interface ExecutiveMemoryFact {
  id: string;
  userKey: string;
  factText: string;
  category: string;
  importance: number;
  lastSeenAt: string;
}

export interface ExecutiveConversationMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutiveConversationSession {
  sessionId: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export interface ExecutiveAssistantMessageState {
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface MemoryFactInsert {
  factText: string;
  category: string;
  importance: number;
}

function normalizeUserKey(rawValue: string | null | undefined): string {
  const fallback = 'open_access';
  if (!rawValue) return fallback;
  const trimmed = rawValue.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 120);
}

export function resolveUserKey(rawValue: string | null | undefined): string {
  return normalizeUserKey(rawValue);
}

export async function getUserMemoryFacts(userKeyInput: string, limit = 12): Promise<ExecutiveMemoryFact[]> {
  const userKey = normalizeUserKey(userKeyInput);
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('executive_agent_memory_facts')
    .select('id,user_key,fact_text,category,importance,last_seen_at')
    .eq('user_key', userKey)
    .order('importance', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return [];

  return data.map((row) => ({
    id: String(row.id),
    userKey: String(row.user_key),
    factText: String(row.fact_text),
    category: String(row.category ?? 'context'),
    importance: Number(row.importance ?? 3),
    lastSeenAt: String(row.last_seen_at)
  }));
}

export async function upsertUserMemoryFacts(
  userKeyInput: string,
  sessionId: string,
  facts: MemoryFactInsert[]
): Promise<number> {
  const userKey = normalizeUserKey(userKeyInput);
  if (!facts.length) return 0;

  const supabase = createServerClient();
  const nowIso = new Date().toISOString();

  const payload = facts.slice(0, 10).map((fact) => ({
    user_key: userKey,
    fact_text: fact.factText.trim().slice(0, 600),
    category: fact.category.trim().slice(0, 60) || 'context',
    importance: Math.min(Math.max(Math.round(fact.importance || 3), 1), 5),
    source_session_id: sessionId.slice(0, 120),
    last_seen_at: nowIso,
    updated_at: nowIso
  }));

  const filteredPayload = payload.filter((fact) => fact.fact_text.length >= 3);
  if (!filteredPayload.length) return 0;

  const { error } = await supabase
    .from('executive_agent_memory_facts')
    .upsert(filteredPayload, { onConflict: 'user_key,fact_text' });

  if (error) return 0;
  return filteredPayload.length;
}

export async function insertConversationMessage(params: {
  userKey: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createServerClient();
  const userKey = normalizeUserKey(params.userKey);

  await supabase.from('executive_agent_messages').insert({
    user_key: userKey,
    session_id: params.sessionId.slice(0, 120),
    role: params.role,
    content: params.content,
    model: params.model ?? null,
    metadata: params.metadata ?? {}
  });
}

export async function listConversationSessions(
  userKeyInput: string,
  limit = 24
): Promise<ExecutiveConversationSession[]> {
  const userKey = normalizeUserKey(userKeyInput);
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('executive_agent_messages')
    .select('id,session_id,content,created_at')
    .eq('user_key', userKey)
    .order('created_at', { ascending: false })
    .limit(1200);

  if (error || !data) return [];

  const sessionMap = new Map<string, ExecutiveConversationSession>();
  for (const row of data) {
    const sessionId = String(row.session_id ?? '');
    if (!sessionId) continue;

    const existing = sessionMap.get(sessionId);
    if (!existing) {
      sessionMap.set(sessionId, {
        sessionId,
        updatedAt: String(row.created_at ?? ''),
        lastMessagePreview: String(row.content ?? '').slice(0, 120),
        messageCount: 1
      });
      continue;
    }
    existing.messageCount += 1;
  }

  return Array.from(sessionMap.values()).slice(0, limit);
}

export async function listConversationMessages(params: {
  userKey: string;
  sessionId: string;
  limit?: number;
}): Promise<ExecutiveConversationMessage[]> {
  const supabase = createServerClient();
  const userKey = normalizeUserKey(params.userKey);

  const { data, error } = await supabase
    .from('executive_agent_messages')
    .select('id,session_id,role,content,created_at,metadata')
    .eq('user_key', userKey)
    .eq('session_id', params.sessionId)
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 300);

  if (error || !data) return [];

  const messages: ExecutiveConversationMessage[] = [];
  for (const row of data) {
    const rawRole = String(row.role);
    if (rawRole !== 'user' && rawRole !== 'assistant') continue;
    messages.push({
      id: String(row.id),
      sessionId: String(row.session_id),
      role: rawRole,
      content: String(row.content),
      createdAt: String(row.created_at),
      metadata:
        typeof row.metadata === 'object' && row.metadata !== null
          ? (row.metadata as Record<string, unknown>)
          : {}
    });
  }
  return messages;
}

export async function listRecentConversationContext(params: {
  userKey: string;
  sessionId: string;
  limit?: number;
}): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await listConversationMessages({
    userKey: params.userKey,
    sessionId: params.sessionId,
    limit: params.limit ?? 24
  });
  return rows.map((row) => ({ role: row.role, content: row.content }));
}

export async function deleteConversationSession(params: {
  userKey: string;
  sessionId: string;
}): Promise<void> {
  const supabase = createServerClient();
  const userKey = normalizeUserKey(params.userKey);

  const { error } = await supabase
    .from('executive_agent_messages')
    .delete()
    .eq('user_key', userKey)
    .eq('session_id', params.sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteConversationMessage(params: {
  userKey: string;
  messageId: string;
}): Promise<void> {
  const supabase = createServerClient();
  const userKey = normalizeUserKey(params.userKey);

  const { error } = await supabase
    .from('executive_agent_messages')
    .delete()
    .eq('user_key', userKey)
    .eq('id', params.messageId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getLatestAssistantMessageState(params: {
  userKey: string;
  sessionId: string;
}): Promise<ExecutiveAssistantMessageState | null> {
  const supabase = createServerClient();
  const userKey = normalizeUserKey(params.userKey);

  const { data, error } = await supabase
    .from('executive_agent_messages')
    .select('created_at,metadata')
    .eq('user_key', userKey)
    .eq('session_id', params.sessionId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    createdAt: String(data.created_at),
    metadata: typeof data.metadata === 'object' && data.metadata !== null ? (data.metadata as Record<string, unknown>) : {}
  };
}
