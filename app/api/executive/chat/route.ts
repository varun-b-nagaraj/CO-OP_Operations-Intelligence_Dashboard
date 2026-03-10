import { NextRequest, NextResponse } from 'next/server';

import { runExecutiveTooling } from '@/lib/server/executive';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function parseAssistantMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { message?: { content?: unknown }; response?: unknown };
  if (typeof candidate.message?.content === 'string') return candidate.message.content;
  if (typeof candidate.response === 'string') return candidate.response;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      conversation?: unknown;
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ ok: false, error: 'Message is required.' }, { status: 400 });
    }

    const conversation = Array.isArray(body.conversation)
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

    const { overview, toolContext, toolTrace } = await runExecutiveTooling(message);

    const systemPrompt = [
      'You are the executive AI agent for the CO-OP Operations dashboard.',
      'Use the provided MCP-style tool output as evidence.',
      'Give concise, direct operational guidance with callouts for risks and follow-up actions.',
      'If data is missing, say what is missing and what dashboard tab to check.',
      '',
      'Executive overview snapshot:',
      overview.executiveBrief,
      '',
      'Tool outputs:',
      toolContext
    ].join('\n');

    const model = process.env.OLLAMA_MODEL?.trim() || 'deepseek-v3.1:671b-cloud';
    const proxyUrl = new URL('/api/backend/shared/ollama/chat', request.url);

    const upstream = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversation.slice(-8).map((entry) => ({
            role: entry.role,
            content: entry.content
          })),
          { role: 'user', content: message }
        ],
        options: {
          temperature: 0.2
        }
      })
    });

    if (!upstream.ok) {
      const fallbackMessage = [
        'Unable to reach Ollama through the internal proxy right now.',
        `Executive snapshot: ${overview.executiveBrief}`,
        'Check the Overview tab for current metrics and the Alerts tab for follow-up actions.'
      ].join(' ');
      return NextResponse.json({
        ok: true,
        source: 'fallback',
        assistantMessage: fallbackMessage,
        toolTrace
      });
    }

    const upstreamJson = (await upstream.json()) as unknown;
    const assistantMessage = parseAssistantMessage(upstreamJson);

    return NextResponse.json({
      ok: true,
      source: 'ollama',
      model,
      assistantMessage:
        assistantMessage ??
        `Tool execution finished, but the model response was empty. Executive snapshot: ${overview.executiveBrief}`,
      toolTrace
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
