CREATE TABLE IF NOT EXISTS public.executive_agent_memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'context',
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source_session_id TEXT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS executive_agent_memory_facts_user_fact_unique
  ON public.executive_agent_memory_facts (user_key, fact_text);

CREATE INDEX IF NOT EXISTS executive_agent_memory_facts_user_last_seen_idx
  ON public.executive_agent_memory_facts (user_key, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.executive_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS executive_agent_messages_user_session_created_idx
  ON public.executive_agent_messages (user_key, session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS executive_agent_messages_user_created_idx
  ON public.executive_agent_messages (user_key, created_at DESC);
