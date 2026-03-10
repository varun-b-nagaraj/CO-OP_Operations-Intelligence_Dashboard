'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { SharedCalendarTab } from '@/app/_components/shared-calendar-tab';
import {
  ExecutiveToolSpec,
  ExecutiveToolStatus,
  getToolSpecById,
  planExecutiveTools
} from '@/lib/executive/tooling';

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

interface ToolTrace {
  id: string;
  label: string;
  status: 'complete' | 'failed';
  startedAt: string;
  finishedAt: string;
  detail: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: boolean;
  pendingTools?: ExecutiveToolSpec[];
  toolTrace?: Array<ToolTrace & { runningText?: string; uiStatus: ExecutiveToolStatus }>;
}

const EXECUTIVE_TABS: Array<{
  id: ExecutiveTabId;
  label: string;
  icon: 'dashboard' | 'analysis' | 'history' | 'prompts' | 'reports' | 'calendar';
}> = [
  { id: 'ai-agent', label: 'AI Agent', icon: 'dashboard' },
  { id: 'overview', label: 'Overview', icon: 'analysis' },
  { id: 'department-feed', label: 'Department Feed', icon: 'history' },
  { id: 'alerts', label: 'Alerts & Exceptions', icon: 'prompts' },
  { id: 'metrics', label: 'Metrics & Trends', icon: 'reports' },
  { id: 'reports', label: 'Reports Center', icon: 'history' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' }
];

const QUICK_PROMPTS = [
  'What changed this week across all departments?',
  'Show attendance risks and pending HR requests.',
  'What new product orders were placed recently?',
  'Summarize recent shift results and CFA updates.',
  'Which alerts need executive attention today?'
];

const MODULE_LINKS = [
  { label: 'HR', href: '/hr?module=hr&tab=schedule' },
  { label: 'Employee', href: '/employee' },
  { label: 'Product', href: '/product' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'Marketing', href: '/marketing' },
  { label: 'Finance', href: '/finance' },
  { label: 'Chick-fil-A', href: '/hr?module=cfa&tab=daily-log' }
];

function toneClass(tone: 'neutral' | 'positive' | 'warning'): string {
  if (tone === 'positive') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-neutral-200 bg-neutral-50 text-neutral-900';
}

function severityClass(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

function healthClass(status: 'healthy' | 'watch' | 'risk'): string {
  if (status === 'healthy') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (status === 'risk') return 'border-red-200 bg-red-50 text-red-900';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

function toolStatusClass(status: ExecutiveToolStatus): string {
  if (status === 'complete') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-neutral-200 bg-neutral-50 text-neutral-700';
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-assistant',
      role: 'assistant',
      pending: false,
      content:
        'I am the executive MCP client assistant. Ask for cross-department updates, recent orders, attendance trends, alerts, or a leadership brief.'
    }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const activeLabel = useMemo(
    () => EXECUTIVE_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Executive Dashboard',
    [activeTab]
  );

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

  useEffect(() => {
    void loadOverview();
  }, []);

  const sendPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || sending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      pending: false
    };

    const plannedTools = planExecutiveTools(trimmed);
    const pendingAssistantId = `assistant-pending-${Date.now()}`;
    const pendingAssistant: ChatMessage = {
      id: pendingAssistantId,
      role: 'assistant',
      content: 'Running MCP tools...',
      pending: true,
      pendingTools: plannedTools
    };

    const nextMessages = [...messages, userMessage, pendingAssistant];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/executive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversation: toConversation(messages)
        })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        assistantMessage?: string;
        toolTrace?: ToolTrace[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Chat request failed.');
      }

      const finalTrace: Array<ToolTrace & { runningText?: string; uiStatus: ExecutiveToolStatus }> =
        payload.toolTrace?.map((entry) => {
          const tool = getToolSpecById(entry.id);
          return {
            ...entry,
            runningText: tool?.runningText,
            uiStatus: entry.status === 'failed' ? 'failed' : 'complete'
          };
        }) ?? [];

      setMessages((current) =>
        current.map((entry) =>
          entry.id === pendingAssistantId
            ? {
                ...entry,
                pending: false,
                content: payload.assistantMessage ?? 'No response generated.',
                toolTrace: finalTrace,
                pendingTools: undefined
              }
            : entry
        )
      );
      void loadOverview();
    } catch (error) {
      setMessages((current) =>
        current.map((entry) =>
          entry.id === pendingAssistantId
            ? {
                ...entry,
                pending: false,
                content: error instanceof Error ? error.message : 'Unable to complete chat request.',
                toolTrace:
                  plannedTools.map((tool) => ({
                    id: tool.id,
                    label: tool.label,
                    status: 'failed',
                    startedAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    detail: 'Tool run failed before completion.',
                    runningText: tool.runningText,
                    uiStatus: 'failed'
                  })) ?? [],
                pendingTools: undefined
              }
            : entry
        )
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <DepartmentShell
      activeNavId={activeTab}
      contentHeading={activeLabel}
      departmentIcon="dashboard"
      navAriaLabel="Executive dashboard navigation"
      navItems={EXECUTIVE_TABS}
      onNavSelect={(id) => setActiveTab(id as ExecutiveTabId)}
      subtitle="Cross-department intelligence with MCP agent tooling and executive summaries"
      title="Executive Dashboard"
    >
      <section className="w-full border-x border-b border-neutral-300 bg-white">
        {activeTab === 'ai-agent' ? (
          <section className="space-y-4 p-4 md:p-6">
            <section className="border border-neutral-300 bg-neutral-50 p-4">
              <h2 className="text-xl font-semibold text-neutral-900">Executive MCP Client</h2>
              <p className="mt-2 text-sm text-neutral-700">
                Ask for updates across HR, Product, Inventory, Marketing, Finance, Employee behavior, and CFA from one
                place.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
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

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3 border border-neutral-300 bg-white p-3">
                <div className="max-h-[56vh] space-y-3 overflow-y-auto border border-neutral-200 bg-neutral-50 p-3">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`border p-3 ${
                        message.role === 'user'
                          ? 'ml-6 border-brand-maroon bg-[#fff5f5]'
                          : 'mr-6 border-neutral-300 bg-white'
                      }`}
                    >
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                        {message.role === 'user' ? 'You' : 'Executive Agent'}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-neutral-900">{message.content}</p>

                      {message.pending && message.pendingTools?.length ? (
                        <div className="mt-3 space-y-2">
                          {message.pendingTools.map((tool) => (
                            <div
                              key={tool.id}
                              className={`border px-2 py-1 text-xs ${toolStatusClass('running')}`}
                              title={tool.runningText}
                            >
                              <p className="font-semibold">{tool.label}</p>
                              <p>{tool.runningText}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {message.toolTrace?.length ? (
                        <div className="mt-3 space-y-2">
                          {message.toolTrace.map((tool) => (
                            <div
                              key={`${message.id}-${tool.id}`}
                              className={`border px-2 py-1 text-xs ${toolStatusClass(tool.uiStatus)}`}
                              title={tool.runningText ?? tool.detail}
                            >
                              <p className="font-semibold">
                                {tool.label} ({tool.uiStatus})
                              </p>
                              <p>{tool.detail}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendPrompt(input);
                  }}
                >
                  <textarea
                    className="min-h-[88px] w-full border border-neutral-300 px-3 py-2 text-sm"
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask for updates (e.g., 'What changed this week across departments?')"
                    value={input}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000] disabled:opacity-60"
                      disabled={sending || !input.trim()}
                      type="submit"
                    >
                      {sending ? 'Running tools...' : 'Send to Agent'}
                    </button>
                    <button
                      className="min-h-[40px] border border-neutral-300 bg-white px-4 text-sm hover:bg-neutral-100"
                      onClick={() =>
                        setMessages([
                          {
                            id: `welcome-assistant-${Date.now()}`,
                            role: 'assistant',
                            pending: false,
                            content:
                              'Conversation reset. Ask for a new executive brief, department update, or risk summary.'
                          }
                        ])
                      }
                      type="button"
                    >
                      New Chat
                    </button>
                  </div>
                </form>
              </div>

              <aside className="space-y-3 border border-neutral-300 bg-neutral-50 p-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Department Shortcuts</h3>
                <div className="flex flex-wrap gap-2">
                  {MODULE_LINKS.map((moduleLink) => (
                    <Link
                      key={moduleLink.href}
                      className="min-h-[34px] border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-100"
                      href={moduleLink.href}
                    >
                      {moduleLink.label}
                    </Link>
                  ))}
                </div>
                <div className="border border-neutral-300 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Last Refresh</p>
                  <p className="mt-1 text-sm text-neutral-900">
                    {overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString() : 'Loading...'}
                  </p>
                </div>
                {overview?.summaryCards.slice(0, 3).map((card) => (
                  <div className={`border p-3 ${toneClass(card.tone)}`} key={card.id}>
                    <p className="text-xs uppercase tracking-wide">{card.title}</p>
                    <p className="mt-1 text-lg font-semibold">{card.value}</p>
                    <p className="mt-1 text-xs">{card.subtitle}</p>
                  </div>
                ))}
              </aside>
            </section>
          </section>
        ) : null}

        {activeTab === 'overview' ? (
          <section className="space-y-4 p-4 md:p-6">
            {loadingOverview ? <p className="text-sm text-neutral-700">Loading executive overview...</p> : null}
            {overviewError ? <p className="text-sm text-red-700">{overviewError}</p> : null}
            {overview ? (
              <>
                <section className="border border-neutral-300 bg-neutral-50 p-4">
                  <h2 className="text-lg font-semibold">Executive Brief</h2>
                  <p className="mt-2 text-sm text-neutral-800">{overview.executiveBrief}</p>
                </section>
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {overview.summaryCards.map((card) => (
                    <article className={`border p-3 ${toneClass(card.tone)}`} key={card.id}>
                      <p className="text-xs uppercase tracking-wide">{card.title}</p>
                      <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                      <p className="mt-1 text-xs">{card.subtitle}</p>
                    </article>
                  ))}
                </section>
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {overview.departmentHealth.map((item) => (
                    <article className={`border p-3 ${healthClass(item.status)}`} key={item.id}>
                      <p className="text-sm font-semibold">{item.department}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide">{item.status}</p>
                      <p className="mt-2 text-sm">{item.summary}</p>
                    </article>
                  ))}
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'department-feed' ? (
          <section className="space-y-3 p-4 md:p-6">
            {overview?.feed.map((item) => (
              <article className={`border p-3 ${severityClass(item.severity)}`} key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {item.department}: {item.title}
                  </p>
                  <p className="text-xs">{item.timestamp}</p>
                </div>
                <p className="mt-1 text-sm">{item.detail}</p>
                <Link className="mt-2 inline-flex text-xs underline" href={item.href}>
                  Open {item.department}
                </Link>
              </article>
            ))}
            {!overview?.feed.length ? <p className="text-sm text-neutral-700">No feed updates available yet.</p> : null}
          </section>
        ) : null}

        {activeTab === 'alerts' ? (
          <section className="space-y-3 p-4 md:p-6">
            {overview?.alerts.map((alert) => (
              <article
                className={`border p-3 ${
                  alert.severity === 'high'
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
                key={alert.id}
              >
                <p className="text-sm font-semibold">
                  {alert.title} ({alert.department})
                </p>
                <p className="mt-1 text-sm">{alert.description}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide">Next step: {alert.action}</p>
              </article>
            ))}
            {!overview?.alerts.length ? <p className="text-sm text-neutral-700">No active alerts.</p> : null}
          </section>
        ) : null}

        {activeTab === 'metrics' ? (
          <section className="grid gap-3 p-4 md:grid-cols-2 md:p-6">
            {overview?.metrics.map((metric) => (
              <article className="border border-neutral-300 bg-white p-4" key={metric.id}>
                <p className="text-xs uppercase tracking-wide text-neutral-600">{metric.title}</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-900">{metric.value}</p>
                <p className="mt-2 text-sm text-neutral-700">{metric.trend}</p>
              </article>
            ))}
            {!overview?.metrics.length ? <p className="text-sm text-neutral-700">No metric snapshots available.</p> : null}
          </section>
        ) : null}

        {activeTab === 'reports' ? (
          <section className="space-y-3 p-4 md:p-6">
            {overview?.reports.map((report) => (
              <article className="border border-neutral-300 bg-white p-3" key={report.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
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
          <section className="p-4 md:p-6">
            <SharedCalendarTab sourceDepartment="exec" />
          </section>
        ) : null}
      </section>
    </DepartmentShell>
  );
}
