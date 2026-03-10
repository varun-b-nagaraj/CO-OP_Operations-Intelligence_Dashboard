import { NextRequest, NextResponse } from 'next/server';

import { getToolSpecById } from '@/lib/executive/tooling';
import {
  getUserMemoryFacts,
  insertConversationMessage,
  listRecentConversationContext,
  resolveUserKey,
  upsertUserMemoryFacts
} from '@/lib/server/executive-memory';
import { ExecutiveToolTraceItem, runExecutiveTooling } from '@/lib/server/executive';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MemoryFactCandidate {
  factText: string;
  category: string;
  importance: number;
}

function parseAssistantMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { message?: { content?: unknown }; response?: unknown };
  if (typeof candidate.message?.content === 'string') return candidate.message.content;
  if (typeof candidate.response === 'string') return candidate.response;
  return null;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { error?: unknown; message?: unknown };
      const maybeError =
        (typeof payload.error === 'string' && payload.error) ||
        (typeof payload.message === 'string' && payload.message) ||
        '';
      if (maybeError) return maybeError;
      return JSON.stringify(payload);
    }
    const text = (await response.text()).trim();
    if (text) return text.slice(0, 500);
    return '';
  } catch {
    return '';
  }
}

function parseJsonObjectString(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Continue with fallback extraction.
  }

  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // Continue with fallback extraction.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeFactCandidates(payload: unknown): MemoryFactCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const facts = (payload as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];

  return facts
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as {
        factText?: unknown;
        category?: unknown;
        importance?: unknown;
      };
      const factText = typeof row.factText === 'string' ? row.factText.trim() : '';
      const category = typeof row.category === 'string' ? row.category.trim().toLowerCase() : 'context';
      const importance =
        typeof row.importance === 'number'
          ? row.importance
          : typeof row.importance === 'string'
            ? Number(row.importance)
            : 3;
      if (!factText) return null;
      return {
        factText: factText.slice(0, 600),
        category: category || 'context',
        importance: Math.min(Math.max(Math.round(Number.isFinite(importance) ? importance : 3), 1), 5)
      };
    })
    .filter((row): row is MemoryFactCandidate => Boolean(row));
}

function toToolTraceItem(params: {
  id: string;
  status: 'complete' | 'failed';
  detail: string;
  startedAt: string;
  finishedAt: string;
}): ExecutiveToolTraceItem {
  return {
    id: params.id,
    label: getToolSpecById(params.id)?.label ?? params.id,
    status: params.status,
    detail: params.detail,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}

function memoryFactsToPromptContext(
  facts: Array<{ factText: string; category: string; importance: number }>
): string {
  if (!facts.length) return 'No saved user preferences yet.';
  return facts.map((fact) => `[${fact.category} | ${fact.importance}/5] ${fact.factText}`).join('\n');
}

async function extractMemoryFactsWithSmallModel(params: {
  request: NextRequest;
  userMessage: string;
  assistantMessage: string;
  existingFactsPrompt: string;
}): Promise<MemoryFactCandidate[]> {
  const memoryModel = process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b';
  const proxyUrl = new URL('/api/backend/shared/ollama/chat', params.request.url);

  const extractionPrompt = [
    'You are a compact memory extraction model.',
    'Extract durable user preferences and critical facts from the latest exchange.',
    'Do not include transient details or one-off operational events.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    '{"facts":[{"factText":"string","category":"preference|constraint|goal|profile|context","importance":1-5}]}',
    '',
    'Existing known facts:',
    params.existingFactsPrompt,
    '',
    'Latest user message:',
    params.userMessage,
    '',
    'Latest assistant response:',
    params.assistantMessage
  ].join('\n');

  const upstream = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: memoryModel,
      stream: false,
      messages: [{ role: 'user', content: extractionPrompt }],
      options: { temperature: 0.0 }
    })
  });

  if (!upstream.ok) return [];
  const upstreamPayload = (await upstream.json()) as unknown;
  const content = parseAssistantMessage(upstreamPayload);
  if (!content) return [];

  const parsed = parseJsonObjectString(content);
  return normalizeFactCandidates(parsed);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      sessionId?: unknown;
      userKey?: unknown;
      conversation?: unknown;
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ ok: false, error: 'Message is required.' }, { status: 400 });
    }

    const userKey = resolveUserKey(typeof body.userKey === 'string' ? body.userKey : null);
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim().slice(0, 120)
        : `session-${crypto.randomUUID()}`;

    const toolTrace: ExecutiveToolTraceItem[] = [];

    const preferencesToolStart = new Date().toISOString();
    let memoryFacts: Awaited<ReturnType<typeof getUserMemoryFacts>> = [];
    try {
      memoryFacts = await getUserMemoryFacts(userKey, 12);
      const preferencesToolEnd = new Date().toISOString();
      const sampleFacts = memoryFacts.slice(0, 3).map((fact) => fact.factText).join(' | ');
      toolTrace.push(
        toToolTraceItem({
          id: 'get_user_preferences',
          status: 'complete',
          detail: memoryFacts.length
            ? `Loaded ${memoryFacts.length} memory fact(s) from Supabase.${sampleFacts ? ` Sample: ${sampleFacts}` : ''}`
            : 'No saved preferences yet; memory table is empty for this user.',
          startedAt: preferencesToolStart,
          finishedAt: preferencesToolEnd
        })
      );
    } catch (error) {
      const preferencesToolEnd = new Date().toISOString();
      toolTrace.push(
        toToolTraceItem({
          id: 'get_user_preferences',
          status: 'failed',
          detail: error instanceof Error ? error.message : 'Failed to fetch memory from Supabase.',
          startedAt: preferencesToolStart,
          finishedAt: preferencesToolEnd
        })
      );
      memoryFacts = [];
    }

    await insertConversationMessage({
      userKey,
      sessionId,
      role: 'user',
      content: message,
      metadata: { source: 'executive_chat_api' }
    });

    const { overview, toolContext, toolTrace: overviewToolTrace } = await runExecutiveTooling(message);

    const memoryContext = memoryFactsToPromptContext(memoryFacts);
    const systemPrompt = [
      'You are the executive AI agent for the CO-OP Operations dashboard.',
      'Use the provided MCP-style tool output as evidence.',
      'Give concise, direct operational guidance with callouts for risks and follow-up actions.',
      'If data is missing, say what is missing and what dashboard tab to check.',
      '',
      'Saved user preferences and critical facts (default tool context):',
      memoryContext,
      '',
      'Executive overview snapshot:',
      overview.executiveBrief,
      '',
      'Tool outputs:',
      toolContext
    ].join('\n');

    const model = process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud';
    const proxyUrl = new URL('/api/backend/shared/ollama/chat', request.url);
    const dbConversation = await listRecentConversationContext({ userKey, sessionId, limit: 20 });

    const fallbackConversation = Array.isArray(body.conversation)
      ? body.conversation.filter(
          (entry): entry is ChatMessage =>
            typeof entry === 'object' &&
            entry !== null &&
            'role' in entry &&
            'content' in entry &&
            (entry as ChatMessage).role !== 'system' &&
            typeof (entry as ChatMessage).content === 'string'
        )
      : [];

    const contextConversation = dbConversation.length
      ? dbConversation
      : fallbackConversation.map((entry) => ({ role: entry.role, content: entry.content }));
    const recentConversation = contextConversation.slice(-12);
    const lastContextMessage = recentConversation[recentConversation.length - 1];
    const hasCurrentUserPromptAlready =
      lastContextMessage?.role === 'user' &&
      lastContextMessage.content.trim().toLowerCase() === message.trim().toLowerCase();

    const upstream = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentConversation.map((entry) => ({
            role: entry.role,
            content: entry.content
          })),
          ...(hasCurrentUserPromptAlready ? [] : [{ role: 'user', content: message }])
        ],
        options: {
          temperature: 0.2
        }
      })
    });

    let assistantMessage = '';
    let source: 'ollama' | 'fallback' = 'ollama';

    if (!upstream.ok) {
      source = 'fallback';
      const upstreamDetail = await readResponseError(upstream);
      assistantMessage = [
        'Unable to reach Ollama through the internal proxy right now.',
        `Upstream status: ${upstream.status}.`,
        upstreamDetail ? `Upstream detail: ${upstreamDetail}` : '',
        `Executive snapshot: ${overview.executiveBrief}`,
        'Check the Overview tab for current metrics and the Alerts tab for follow-up actions.'
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      const upstreamJson = (await upstream.json()) as unknown;
      assistantMessage =
        parseAssistantMessage(upstreamJson) ??
        `Tool execution finished, but the model response was empty. Executive snapshot: ${overview.executiveBrief}`;
    }

    await insertConversationMessage({
      userKey,
      sessionId,
      role: 'assistant',
      content: assistantMessage,
      model: model,
      metadata: { source }
    });

    const memoryWriteStart = new Date().toISOString();
    let memoryWriteCount = 0;
    try {
      const extractedFacts = await extractMemoryFactsWithSmallModel({
        request,
        userMessage: message,
        assistantMessage,
        existingFactsPrompt: memoryContext
      });
      memoryWriteCount = await upsertUserMemoryFacts(
        userKey,
        sessionId,
        extractedFacts.map((fact) => ({
          factText: fact.factText,
          category: fact.category,
          importance: fact.importance
        }))
      );
      const memoryWriteEnd = new Date().toISOString();
      toolTrace.push(
        toToolTraceItem({
          id: 'sync_user_memory',
          status: 'complete',
          detail:
            memoryWriteCount > 0
              ? `qwen3:8b saved ${memoryWriteCount} condensed fact(s) to memory.`
              : 'qwen3:8b found no new durable facts to store.',
          startedAt: memoryWriteStart,
          finishedAt: memoryWriteEnd
        })
      );
    } catch (error) {
      const memoryWriteEnd = new Date().toISOString();
      toolTrace.push(
        toToolTraceItem({
          id: 'sync_user_memory',
          status: 'failed',
          detail: error instanceof Error ? error.message : 'Memory writer failed.',
          startedAt: memoryWriteStart,
          finishedAt: memoryWriteEnd
        })
      );
    }

    return NextResponse.json({
      ok: true,
      source,
      model,
      memoryModel: process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b',
      userKey,
      sessionId,
      assistantMessage,
      toolTrace: [...toolTrace, ...overviewToolTrace],
      memoryFactsWritten: memoryWriteCount
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to process executive chat.'
      },
      { status: 500 }
    );
  }
}
