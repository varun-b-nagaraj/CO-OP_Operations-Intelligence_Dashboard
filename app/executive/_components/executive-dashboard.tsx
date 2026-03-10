'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { SharedCalendarTab } from '@/app/_components/shared-calendar-tab';
import { planExecutiveTools } from '@/lib/executive/tooling';

type ExecutiveTabId =
  | 'ai-agent'
  | 'overview'
  | 'department-feed'
  | 'alerts'
  | 'metrics'
  | 'reports'
  | 'calendar';

interface ExecutiveSummaryCard {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'neutral' | 'positive' | 'warning';
}

interface ExecutiveFeedItem {
  id: string;
  department: string;
  title: string;
  detail: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  href: string;
}

interface ExecutiveAlert {
  id: string;
  title: string;
  department: string;
  severity: 'medium' | 'high';
  description: string;
  action: string;
}

interface ExecutiveMetric {
  id: string;
  title: string;
  value: string;
  trend: string;
}

interface ExecutiveReportItem {
  id: string;
  type: string;
  title: string;
  status: string;
  updatedAt: string;
  owner: string;
  href: string;
}

interface DepartmentHealthItem {
  id: string;
  department: string;
  status: 'healthy' | 'watch' | 'risk';
  summary: string;
}

interface ExecutiveOverviewData {
  generatedAt: string;
  executiveBrief: string;
  summaryCards: ExecutiveSummaryCard[];
  feed: ExecutiveFeedItem[];
  alerts: ExecutiveAlert[];
  metrics: ExecutiveMetric[];
  reports: ExecutiveReportItem[];
  departmentHealth: DepartmentHealthItem[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: boolean;
}

interface ConversationSession {
  sessionId: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

const USER_KEY_STORAGE = 'executive_agent_user_key_v1';

const EXECUTIVE_TABS: Array<{ id: ExecutiveTabId; label: string }> = [
  { id: 'ai-agent', label: 'AI Agent' },
  { id: 'overview', label: 'Overview' },
  { id: 'department-feed', label: 'Feed' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'reports', label: 'Reports' },
  { id: 'calendar', label: 'Calendar' }
];

const QUICK_PROMPTS = [
  'What changed this week across all departments?',
  'Show attendance risks and pending HR requests.',
  'What new product orders were placed recently?',
  'Summarize recent shift results and CFA updates.',
  'Which alerts need executive attention today?'
];

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toneClass(tone: 'neutral' | 'positive' | 'warning'): string {
  if (tone === 'positive') return 'border-emerald-200 bg-emerald-50';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50';
  return 'border-neutral-200 bg-white';
}

function severityClass(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50';
  return 'border-sky-200 bg-sky-50';
}

function healthClass(status: 'healthy' | 'watch' | 'risk'): string {
  if (status === 'healthy') return 'border-emerald-200 bg-emerald-50';
  if (status === 'risk') return 'border-red-200 bg-red-50';
  return 'border-amber-200 bg-amber-50';
}

function formatSessionTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function toConversation(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.pending)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

export function ExecutiveDashboard() {
  const [activeTab, setActiveTab] = useState<ExecutiveTabId>('ai-agent');

  const [overview, setOverview] = useState<ExecutiveOverviewData | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [userKey, setUserKey] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeBreadcrumbs, setActiveBreadcrumbs] = useState<string[]>([]);
  const [breadcrumbIndex, setBreadcrumbIndex] = useState(0);

  const loadOverview = async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const response = await fetch('/api/executive/overview', { cache: 'no-store' });
      const payload = (await response.json()) as { ok: boolean; data?: ExecutiveOverviewData; error?: string };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error ?? 'Failed to load executive overview.');
      }
      setOverview(payload.data);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Failed to load executive overview.');
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadMessagesForSession = async (currentUserKey: string, sessionId: string) => {
    if (!currentUserKey || !sessionId) return;
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams({ userKey: currentUserKey, sessionId });
      const response = await fetch(`/api/executive/history/messages?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        ok: boolean;
        messages?: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to load messages.');
      }
      const loadedMessages: ChatMessage[] =
        payload.messages?.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          pending: false
        })) ?? [];
      setMessages(loadedMessages);
    } catch (error) {
      setMessages([
        {
          id: `history-error-${Date.now()}`,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Failed to load conversation history.',
          pending: false
        }
      ]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadSessions = async (currentUserKey: string, preferredSessionId?: string) => {
    if (!currentUserKey) return;
    setLoadingSessions(true);
    try {
      const params = new URLSearchParams({ userKey: currentUserKey });
      const response = await fetch(`/api/executive/history/sessions?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        ok: boolean;
        sessions?: ConversationSession[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to load sessions.');
      }

      const nextSessions = payload.sessions ?? [];
      setSessions(nextSessions);

      const preferred =
        preferredSessionId && nextSessions.some((session) => session.sessionId === preferredSessionId)
          ? preferredSessionId
          : '';
      const keepCurrent =
        !preferred &&
        activeSessionId &&
        nextSessions.some((session) => session.sessionId === activeSessionId)
          ? activeSessionId
          : '';
      const fallback = nextSessions[0]?.sessionId ?? '';
      const nextActive = preferred || keepCurrent || fallback;

      if (nextActive) {
        setActiveSessionId(nextActive);
        await loadMessagesForSession(currentUserKey, nextActive);
      }
    } catch {
      // Ignore and allow fresh chat.
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 1024) setHistoryOpen(false);

    const existing = window.localStorage.getItem(USER_KEY_STORAGE);
    if (existing?.trim()) {
      setUserKey(existing);
      return;
    }
    const generated = `exec-user-${crypto.randomUUID()}`;
    window.localStorage.setItem(USER_KEY_STORAGE, generated);
    setUserKey(generated);
  }, []);

  useEffect(() => {
    if (!userKey) return;
    void loadSessions(userKey);
  }, [userKey]);

  useEffect(() => {
    if (!sending || !activeBreadcrumbs.length) return;
    const timer = window.setInterval(() => {
      setBreadcrumbIndex((current) => (current + 1) % activeBreadcrumbs.length);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [sending, activeBreadcrumbs]);

  const startNewConversation = () => {
    const newSessionId = createSessionId();
    setActiveSessionId(newSessionId);
    setMessages([]);
    setInput('');
    setSessions((current) => [
      {
        sessionId: newSessionId,
        updatedAt: new Date().toISOString(),
        lastMessagePreview: 'New conversation',
        messageCount: 0
      },
      ...current.filter((session) => session.sessionId !== newSessionId)
    ]);
  };

  const openSession = async (sessionId: string) => {
    if (!userKey) return;
    setActiveSessionId(sessionId);
    await loadMessagesForSession(userKey, sessionId);
  };

  const sendPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || sending || !userKey) return;

    const workingSessionId = activeSessionId || createSessionId();
    if (!activeSessionId) {
      setActiveSessionId(workingSessionId);
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      pending: false
    };
    const pendingAssistantId = `assistant-pending-${Date.now()}`;
    const pendingAssistant: ChatMessage = {
      id: pendingAssistantId,
      role: 'assistant',
      content: '',
      pending: true
    };
    const snapshot = [...messages];
    setMessages([...snapshot, userMessage, pendingAssistant]);
    setInput('');
    setSending(true);

    const planned = planExecutiveTools(trimmed).map((tool) => tool.runningText);
    setActiveBreadcrumbs(planned);
    setBreadcrumbIndex(0);

    try {
      const response = await fetch('/api/executive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversation: toConversation(snapshot),
          userKey,
          sessionId: workingSessionId
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        assistantMessage?: string;
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Chat request failed.');
      }

      const assistantText = payload.assistantMessage ?? 'No response generated.';
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                pending: false,
                content: assistantText
              }
            : message
        )
      );

      const finalSessionId = payload.sessionId ?? workingSessionId;
      setActiveSessionId(finalSessionId);
      await loadSessions(userKey, finalSessionId);
      void loadOverview();
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : 'Unable to complete chat request right now.';
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                pending: false,
                content: fallback
              }
            : message
        )
      );
    } finally {
      setSending(false);
      setActiveBreadcrumbs([]);
      setBreadcrumbIndex(0);
    }
  };

  const activeBreadcrumb = activeBreadcrumbs[breadcrumbIndex] ?? '';

  return (
    <main className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            {activeTab === 'ai-agent' ? (
              <button
                className="min-h-[34px] border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100"
                onClick={() => setHistoryOpen((current) => !current)}
                type="button"
              >
                {historyOpen ? 'Hide History' : 'Show History'}
              </button>
            ) : null}
            <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Executive Dashboard</h1>
          </div>
          <nav className="flex max-w-full items-center gap-1 overflow-x-auto">
            {EXECUTIVE_TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  className={`min-h-[34px] whitespace-nowrap border px-3 text-xs ${
                    isActive
                      ? 'border-brand-maroon bg-brand-maroon text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {activeTab === 'ai-agent' ? (
        <section className="mx-auto flex h-[calc(100vh-63px)] w-full max-w-[1400px]">
          {historyOpen ? (
            <aside className="w-full max-w-[260px] border-r border-neutral-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Conversations</h2>
                <button
                  className="min-h-[30px] border border-neutral-300 bg-white px-2 text-xs hover:bg-neutral-100"
                  onClick={startNewConversation}
                  type="button"
                >
                  + New
                </button>
              </div>
              <p className="mb-2 truncate text-[11px] text-neutral-500">User: {userKey || 'loading...'}</p>
              <div className="max-h-[calc(100vh-190px)] space-y-2 overflow-y-auto">
                {loadingSessions ? <p className="text-xs text-neutral-600">Loading sessions...</p> : null}
                {!loadingSessions && sessions.length === 0 ? (
                  <p className="text-xs text-neutral-600">No saved conversations yet.</p>
                ) : null}
                {sessions.map((session) => {
                  const isActive = session.sessionId === activeSessionId;
                  return (
                    <button
                      key={session.sessionId}
                      className={`w-full border p-2 text-left ${
                        isActive ? 'border-brand-maroon bg-[#fff5f5]' : 'border-neutral-300 bg-white hover:bg-neutral-100'
                      }`}
                      onClick={() => void openSession(session.sessionId)}
                      type="button"
                    >
                      <p className="truncate text-xs font-medium text-neutral-900">
                        {session.lastMessagePreview || 'Conversation'}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {formatSessionTimestamp(session.updatedAt)} | {session.messageCount}
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto w-full max-w-3xl space-y-6">
                {!loadingMessages && messages.length === 0 ? (
                  <section className="space-y-4 py-16 text-center">
                    <h2 className="text-3xl font-semibold tracking-tight text-neutral-900">Executive AI Agent</h2>
                    <p className="mx-auto max-w-xl text-sm text-neutral-600">
                      Ask one question to get cross-department insights from Product, HR, Inventory, Marketing, Finance,
                      and CFA.
                    </p>
                    <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
                      {QUICK_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          className="min-h-[34px] border border-neutral-300 bg-white px-3 text-xs text-neutral-800 hover:bg-neutral-100"
                          onClick={() => void sendPrompt(prompt)}
                          type="button"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {loadingMessages ? <p className="text-sm text-neutral-600">Loading conversation...</p> : null}

                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[84%] rounded-2xl px-4 py-3 text-[15px] leading-6 shadow-sm ${
                        message.role === 'user'
                          ? 'bg-neutral-900 text-white'
                          : 'border border-neutral-200 bg-white text-neutral-900'
                      }`}
                    >
                      {message.pending ? (
                        <div className="flex items-center gap-1.5 text-sm text-neutral-500">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:240ms]" />
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="border-t border-neutral-200 bg-white px-4 py-4">
              <div className="mx-auto w-full max-w-3xl">
                {sending && activeBreadcrumb ? (
                  <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                    <span>{activeBreadcrumb}</span>
                  </div>
                ) : null}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendPrompt(input);
                  }}
                >
                  <div className="rounded-2xl border border-neutral-300 bg-white p-2 shadow-sm">
                    <textarea
                      className="max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendPrompt(input);
                        }
                      }}
                      placeholder="Ask executive AI anything..."
                      value={input}
                    />
                    <div className="mt-2 flex items-center justify-between px-2 pb-1">
                      <p className="text-[11px] text-neutral-500">Enter to send, Shift+Enter for new line</p>
                      <button
                        className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-4 text-xs font-medium text-white hover:bg-[#6a0000] disabled:opacity-60"
                        disabled={sending || !input.trim() || loadingMessages}
                        type="submit"
                      >
                        {sending ? 'Working...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'overview' ? (
        <section className="mx-auto w-full max-w-[1100px] space-y-4 p-4 md:p-6">
          {loadingOverview ? <p className="text-sm text-neutral-700">Loading executive overview...</p> : null}
          {overviewError ? <p className="text-sm text-red-700">{overviewError}</p> : null}
          {overview ? (
            <>
              <section className="border border-neutral-300 bg-white p-4">
                <h2 className="text-lg font-semibold">Executive Brief</h2>
                <p className="mt-2 text-sm text-neutral-700">{overview.executiveBrief}</p>
              </section>
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {overview.summaryCards.map((card) => (
                  <article className={`border p-3 ${toneClass(card.tone)}`} key={card.id}>
                    <p className="text-xs uppercase tracking-wide text-neutral-500">{card.title}</p>
                    <p className="mt-1 text-2xl font-semibold text-neutral-900">{card.value}</p>
                    <p className="mt-1 text-xs text-neutral-700">{card.subtitle}</p>
                  </article>
                ))}
              </section>
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {overview.departmentHealth.map((item) => (
                  <article className={`border p-3 ${healthClass(item.status)}`} key={item.id}>
                    <p className="text-sm font-semibold text-neutral-900">{item.department}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-neutral-600">{item.status}</p>
                    <p className="mt-2 text-sm text-neutral-700">{item.summary}</p>
                  </article>
                ))}
              </section>
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'department-feed' ? (
        <section className="mx-auto w-full max-w-[1100px] space-y-3 p-4 md:p-6">
          {overview?.feed.map((item) => (
            <article className={`border p-3 ${severityClass(item.severity)}`} key={item.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">
                  {item.department}: {item.title}
                </p>
                <p className="text-xs text-neutral-700">{item.timestamp}</p>
              </div>
              <p className="mt-1 text-sm text-neutral-800">{item.detail}</p>
              <Link className="mt-2 inline-flex text-xs underline" href={item.href}>
                Open {item.department}
              </Link>
            </article>
          ))}
          {!overview?.feed.length ? <p className="text-sm text-neutral-700">No feed updates available yet.</p> : null}
        </section>
      ) : null}

      {activeTab === 'alerts' ? (
        <section className="mx-auto w-full max-w-[1100px] space-y-3 p-4 md:p-6">
          {overview?.alerts.map((alert) => (
            <article
              className={`border p-3 ${
                alert.severity === 'high' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
              }`}
              key={alert.id}
            >
              <p className="text-sm font-semibold text-neutral-900">
                {alert.title} ({alert.department})
              </p>
              <p className="mt-1 text-sm text-neutral-800">{alert.description}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
                Next step: {alert.action}
              </p>
            </article>
          ))}
          {!overview?.alerts.length ? <p className="text-sm text-neutral-700">No active alerts.</p> : null}
        </section>
      ) : null}

      {activeTab === 'metrics' ? (
        <section className="mx-auto grid w-full max-w-[1100px] gap-3 p-4 md:grid-cols-2 md:p-6">
          {overview?.metrics.map((metric) => (
            <article className="border border-neutral-300 bg-white p-4" key={metric.id}>
              <p className="text-xs uppercase tracking-wide text-neutral-500">{metric.title}</p>
              <p className="mt-1 text-2xl font-semibold text-neutral-900">{metric.value}</p>
              <p className="mt-2 text-sm text-neutral-700">{metric.trend}</p>
            </article>
          ))}
          {!overview?.metrics.length ? <p className="text-sm text-neutral-700">No metric snapshots available.</p> : null}
        </section>
      ) : null}

      {activeTab === 'reports' ? (
        <section className="mx-auto w-full max-w-[1100px] space-y-3 p-4 md:p-6">
          {overview?.reports.map((report) => (
            <article className="border border-neutral-300 bg-white p-3" key={report.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">
                  {report.type}: {report.title}
                </p>
                <p className="text-xs text-neutral-600">{report.updatedAt}</p>
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-neutral-600">
                Status: {report.status} | Owner: {report.owner}
              </p>
              <Link className="mt-2 inline-flex text-xs underline" href={report.href}>
                Open source module
              </Link>
            </article>
          ))}
          {!overview?.reports.length ? <p className="text-sm text-neutral-700">No report records available.</p> : null}
        </section>
      ) : null}

      {activeTab === 'calendar' ? (
        <section className="mx-auto w-full max-w-[1300px] p-4 md:p-6">
          <div className="border border-neutral-300 bg-white">
            <SharedCalendarTab sourceDepartment="exec" />
          </div>
        </section>
      ) : null}
    </main>
  );
}
