import { NextRequest, NextResponse } from 'next/server';

import { ensureServerPermission } from '@/lib/server/permissions';
import {
  getToolSpecById,
  isGreetingPrompt,
  isOperationalDataPrompt,
  requiresFreshDataPrompt
} from '@/lib/executive/tooling';
import {
  getLatestAssistantMessageState,
  getUserMemoryFacts,
  insertConversationMessage,
  listRecentConversationContext,
  resolveUserKey,
  upsertUserMemoryFacts
} from '@/lib/server/executive-memory';
import {
  ExecutiveOverviewData,
  ExecutiveToolTraceItem,
  runExecutiveTooling
} from '@/lib/server/executive';
import { proxyOllamaChatRequest } from '@/lib/server/ollama-proxy';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MemoryFactCandidate {
  factText: string;
  category: string;
  importance: number;
}

interface ToolingCachePayload {
  generatedAt: string;
  toolContext: string;
  overview: ExecutiveOverviewData;
  toolTrace: ExecutiveToolTraceItem[];
}

function isScheduleRosterPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes('schedule') ||
    normalized.includes('scheduled') ||
    normalized.includes('who is working') ||
    normalized.includes("who's working") ||
    normalized.includes('work tomorrow') ||
    normalized.includes('tomorrow')
  );
}

function buildScheduleAssistantReply(message: string, overview: ExecutiveOverviewData): string {
  const schedule = overview.tomorrowSchedule;
  if (!schedule) {
    return 'Schedule data is missing from this tool run. I can rerun and return tomorrow roster details.';
  }

  if (!schedule.workers.length) {
    return `No scheduled workers were found for ${schedule.date} in the shift schedule dataset.`;
  }

  const uniqueWorkers = Array.from(new Map(schedule.workers.map((worker) => [worker.sNumber, worker])).values());
  const workerList = uniqueWorkers
    .slice(0, 40)
    .map((worker) => `${worker.name} (P${worker.period})`)
    .join(', ');

  const asksWho = /\bwho\b/.test(message.toLowerCase());
  if (asksWho) {
    return `Scheduled to work on ${schedule.date}: ${workerList}. Total scheduled workers: ${uniqueWorkers.length}.`;
  }

  return `Tomorrow's schedule (${schedule.date}) has ${uniqueWorkers.length} workers: ${workerList}.`;
}

function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function streamOllamaMessage(
  response: Response,
  onDelta: (text: string) => void
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { message?: { content?: unknown }; response?: unknown; done?: unknown };
        const delta =
          typeof parsed.message?.content === 'string'
            ? parsed.message.content
            : typeof parsed.response === 'string'
              ? parsed.response
              : '';
        if (delta) {
          content += delta;
          onDelta(delta);
        }
      } catch {
        // Ignore non-JSON lines from upstream stream.
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim()) as { message?: { content?: unknown }; response?: unknown };
      const delta =
        typeof parsed.message?.content === 'string'
          ? parsed.message.content
          : typeof parsed.response === 'string'
            ? parsed.response
            : '';
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    } catch {
      // Ignore trailing parse errors.
    }
  }

  return content;
}

function parseAssistantMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { message?: { content?: unknown }; response?: unknown };
  if (typeof candidate.message?.content === 'string') return candidate.message.content;
  if (typeof candidate.response === 'string') return candidate.response;
  return null;
}

function maybeToolingCache(payload: unknown): ToolingCachePayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as {
    generatedAt?: unknown;
    toolContext?: unknown;
    overview?: unknown;
    toolTrace?: unknown;
  };
  if (typeof candidate.generatedAt !== 'string') return null;
  if (typeof candidate.toolContext !== 'string') return null;
  if (!candidate.overview || typeof candidate.overview !== 'object') return null;
  if (!Array.isArray(candidate.toolTrace)) return null;
  return candidate as ToolingCachePayload;
}

function isRecentCache(createdAt: string, maxAgeMs = 2 * 60 * 1000): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= maxAgeMs;
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
    if (/<!doctype html/i.test(text) || /<html/i.test(text)) {
      if (/vercel/i.test(text) || /authentication required/i.test(text)) {
        return 'Received Vercel authentication HTML page from upstream instead of Ollama API JSON.';
      }
      return 'Received HTML response from upstream instead of Ollama API JSON.';
    }
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
  userMessage: string;
  assistantMessage: string;
  existingFactsPrompt: string;
}): Promise<MemoryFactCandidate[]> {
  const memoryModel = process.env.OLLAMA_MEMORY_MODEL?.trim() || 'qwen3:8b';

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

  const upstream = await proxyOllamaChatRequest({
    body: {
      model: memoryModel,
      stream: false,
      messages: [{ role: 'user', content: extractionPrompt }],
      options: { temperature: 0.0 }
    }
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
    const allowed = await ensureServerPermission('executive.ai_agent.view');
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      message?: unknown;
      sessionId?: unknown;
      userKey?: unknown;
      conversation?: unknown;
      stream?: unknown;
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const streamRequested = body.stream === true;
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
            ? `Load durable preferences from Supabase memory. Result: Loaded ${memoryFacts.length} memory fact(s).${sampleFacts ? ` Sample: ${sampleFacts}` : ''}`
            : 'Load durable preferences from Supabase memory. Result: No saved preferences yet; memory table is empty for this user.',
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
          detail: `Load durable preferences from Supabase memory. Result: ${
            error instanceof Error ? error.message : 'Failed to fetch memory from Supabase.'
          }`,
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

    const memoryContext = memoryFactsToPromptContext(memoryFacts);
    const wantsOperationalData = isOperationalDataPrompt(message);
    const isGreeting = isGreetingPrompt(message);

    let overview: ExecutiveOverviewData | null = null;
    let toolContext = '';
    let overviewToolTrace: ExecutiveToolTraceItem[] = [];
    let toolingMode: 'fresh' | 'reused' | 'skipped' = 'skipped';

    if (wantsOperationalData) {
      const latestAssistantState = await getLatestAssistantMessageState({ userKey, sessionId });
      const cachedTooling = maybeToolingCache(
        latestAssistantState?.metadata?.tooling_cache ?? null
      );
      const cacheReusable =
        Boolean(latestAssistantState && cachedTooling) &&
        !requiresFreshDataPrompt(message) &&
        isRecentCache(latestAssistantState?.createdAt ?? '');

      if (cacheReusable && cachedTooling && latestAssistantState) {
        toolingMode = 'reused';
        overview = cachedTooling.overview;
        toolContext = cachedTooling.toolContext;
        const startedAt = new Date().toISOString();
        const finishedAt = new Date().toISOString();
        overviewToolTrace = [
          toToolTraceItem({
            id: 'use_recent_context',
            status: 'complete',
            detail: `Reused recent executive context from ${latestAssistantState.createdAt}.`,
            startedAt,
            finishedAt
          }),
          ...cachedTooling.toolTrace
        ];
      } else {
        toolingMode = 'fresh';
        const toolingResult = await runExecutiveTooling(message);
        overview = toolingResult.overview;
        toolContext = toolingResult.toolContext;
        overviewToolTrace = toolingResult.toolTrace;
      }
    }

    const systemPrompt = [
      'You are the executive AI agent for the CO-OP Operations dashboard.',
      'Conversation style requirements:',
      '- Be natural and concise.',
      '- If the user says hi/hello/small-talk, respond casually in 1-2 sentences and ask what they want.',
      '- Do not dump metrics unless the user explicitly asks for status, overview, trends, or analysis.',
      '- When discussing shift attendance, prioritize morning and off-period attendance and their average; do not prioritize general shift attendance.',
      '- Ground every factual claim in the provided tool outputs or conversation history. Never invent fields, departments, or placeholders.',
      '- Assume you have access to the executive tool outputs across HR, Product, Finance, Marketing, Inventory, CFA, and shared calendar when they are provided below.',
      '- Do not claim lack of access unless tool outputs for that domain are truly absent in this turn; if absent, state exactly which dataset is missing.',
      '- Do not produce generic numbered templates (for example 1..10 categories) unless the user explicitly asks for that format.',
      '- For direct questions like "who came?" or "how many came?", answer in the first sentence with exact date + names/counts from tool output.',
      '- For "consistently skipped" / "<50% attendance" questions, use morning meeting trend results from tool output and return names with percentages.',
      '- Avoid repetitive wording and avoid unnecessary warnings.',
      '- If a specific detail is unavailable, state exactly what is missing and continue with the available data.',
      '',
      'Saved user preferences and critical facts:',
      memoryContext,
      '',
      wantsOperationalData && overview
        ? `Executive overview snapshot:\n${overview.executiveBrief}`
        : 'No operational tool snapshot was requested for this turn.',
      '',
      wantsOperationalData && toolContext
        ? `Tool outputs:\n${toolContext}`
        : 'No operational tool output was requested for this turn.',
      '',
      isGreeting
        ? 'The latest user message is a greeting or casual opener. Keep your response short and friendly.'
        : 'Answer directly based on the user request.'
    ].join('\n');

    const model = process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud';
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
    const recentConversation = contextConversation.slice(isGreeting ? -2 : -12);
    const lastContextMessage = recentConversation[recentConversation.length - 1];
    const hasCurrentUserPromptAlready =
      lastContextMessage?.role === 'user' &&
      lastContextMessage.content.trim().toLowerCase() === message.trim().toLowerCase();

    let assistantMessage = '';
    let source: 'ollama' | 'fallback' | 'tooling' = 'ollama';
    let upstream: Response | null = null;

    const shouldForceScheduleReply =
      wantsOperationalData && Boolean(overview) && isScheduleRosterPrompt(message);
    if (shouldForceScheduleReply && overview) {
      source = 'tooling';
      assistantMessage = buildScheduleAssistantReply(message, overview);
    } else {
      upstream = await proxyOllamaChatRequest({
        body: {
          model,
          stream: streamRequested,
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentConversation.map((entry) => ({
              role: entry.role,
              content: entry.content
            })),
            ...(hasCurrentUserPromptAlready ? [] : [{ role: 'user', content: message }])
          ],
          options: {
            temperature: 0.1
          }
        }
      });

      if (!upstream.ok) {
        source = 'fallback';
        const upstreamDetail = await readResponseError(upstream);
        const debugId = upstream.headers.get('x-coop-ollama-debug-id') ?? '';
        const isAuthError = upstream.status === 401 || upstream.status === 403;
        assistantMessage = [
          isAuthError
            ? 'Ollama authentication failed through the internal proxy.'
            : 'Unable to reach Ollama through the internal proxy right now.',
          `Upstream status: ${upstream.status}.`,
          upstreamDetail ? `Upstream detail: ${upstreamDetail}` : '',
          debugId ? `Debug ID: ${debugId}.` : '',
          isAuthError
            ? 'Check OLLAMA_API_KEY and OLLAMA_BASE_URL in Vercel environment settings.'
            : '',
          overview ? `Executive snapshot: ${overview.executiveBrief}` : '',
          overview
            ? 'Check the Overview tab for current metrics and the Alerts tab for follow-up actions.'
            : 'Try again in a moment.'
        ]
          .filter(Boolean)
          .join(' ');
      } else if (!streamRequested) {
        const upstreamJson = (await upstream.json()) as unknown;
        assistantMessage =
          parseAssistantMessage(upstreamJson) ??
          [
            'Tool execution finished, but the model response was empty.',
            overview ? `Executive snapshot: ${overview.executiveBrief}` : ''
          ]
            .filter(Boolean)
            .join(' ');
        if (!assistantMessage) {
          assistantMessage = [
            'Tool execution finished, but the model response was empty.',
            overview ? `Executive snapshot: ${overview.executiveBrief}` : ''
          ]
            .filter(Boolean)
            .join(' ');
        }
      }
    }

    const assistantMetadata: Record<string, unknown> = {
      source,
      tooling_mode: toolingMode
    };
    if (wantsOperationalData && overview) {
      assistantMetadata.tooling_cache = {
        generatedAt: new Date().toISOString(),
        toolContext,
        overview,
        toolTrace: overviewToolTrace
      } satisfies ToolingCachePayload;
    }

    if (streamRequested) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, payload: unknown) => {
            controller.enqueue(encoder.encode(sseEvent(event, payload)));
          };

          try {
            send('start', { sessionId, model });
            if (source === 'ollama' && upstream?.ok) {
              assistantMessage = await streamOllamaMessage(upstream, (delta) => {
                send('delta', { text: delta });
              });
            } else if (assistantMessage) {
              send('delta', { text: assistantMessage });
            }

            await insertConversationMessage({
              userKey,
              sessionId,
              role: 'assistant',
              content: assistantMessage,
              model: model,
              metadata: assistantMetadata
            });

            const memoryWriteStart = new Date().toISOString();
            let memoryWriteCount = 0;
            const shouldRunMemoryWriter = wantsOperationalData || message.trim().length >= 10;

            if (!shouldRunMemoryWriter) {
              const memoryWriteEnd = new Date().toISOString();
              toolTrace.push(
                toToolTraceItem({
                  id: 'sync_user_memory',
                  status: 'complete',
                  detail:
                    'Condense durable facts with qwen3:8b and sync memory. Result: skipped for short conversational turn.',
                  startedAt: memoryWriteStart,
                  finishedAt: memoryWriteEnd
                })
              );
            } else {
              try {
                const extractedFacts = await extractMemoryFactsWithSmallModel({
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
                        ? `Condense durable facts with qwen3:8b and sync memory. Result: saved ${memoryWriteCount} condensed fact(s).`
                        : 'Condense durable facts with qwen3:8b and sync memory. Result: no new durable facts to store.',
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
                    detail: `Condense durable facts with qwen3:8b and sync memory. Result: ${
                      error instanceof Error ? error.message : 'Memory writer failed.'
                    }`,
                    startedAt: memoryWriteStart,
                    finishedAt: memoryWriteEnd
                  })
                );
              }
            }

            send('done', {
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
            send('error', {
              ok: false,
              error: error instanceof Error ? error.message : 'Failed during executive chat streaming.'
            });
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        }
      });
    }

    await insertConversationMessage({
      userKey,
      sessionId,
      role: 'assistant',
      content: assistantMessage,
      model: model,
      metadata: assistantMetadata
    });

    const memoryWriteStart = new Date().toISOString();
    let memoryWriteCount = 0;
    const shouldRunMemoryWriter = wantsOperationalData || message.trim().length >= 10;

    if (!shouldRunMemoryWriter) {
      const memoryWriteEnd = new Date().toISOString();
        toolTrace.push(
          toToolTraceItem({
            id: 'sync_user_memory',
            status: 'complete',
            detail: 'Condense durable facts with qwen3:8b and sync memory. Result: skipped for short conversational turn.',
            startedAt: memoryWriteStart,
            finishedAt: memoryWriteEnd
          })
      );
    } else {
      try {
        const extractedFacts = await extractMemoryFactsWithSmallModel({
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
                ? `Condense durable facts with qwen3:8b and sync memory. Result: saved ${memoryWriteCount} condensed fact(s).`
                : 'Condense durable facts with qwen3:8b and sync memory. Result: no new durable facts to store.',
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
            detail: `Condense durable facts with qwen3:8b and sync memory. Result: ${
              error instanceof Error ? error.message : 'Memory writer failed.'
            }`,
            startedAt: memoryWriteStart,
            finishedAt: memoryWriteEnd
          })
        );
      }
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
