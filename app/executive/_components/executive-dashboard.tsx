'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { AccessControlTab } from '@/app/executive/_components/access-control-tab';
import { ExecutiveAuditLog } from '@/app/executive/_components/executive-audit-log';
import { planExecutiveTools } from '@/lib/executive/tooling';
import { usePermission } from '@/lib/permissions';

type ExecutiveTabId =
  | 'ai-agent'
  | 'overview'
  | 'department-hr'
  | 'department-product'
  | 'department-finance'
  | 'department-marketing'
  | 'department-inventory'
  | 'department-cfa'
  | 'audit-log'
  | 'access-control';

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
  provenance?: unknown;
}

interface ConversationSession {
  sessionId: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

const USER_KEY_STORAGE = 'executive_agent_user_key_v1';
const CHAT_STICKY_THRESHOLD_PX = 48;

const EXECUTIVE_TABS: Array<{
  id: ExecutiveTabId;
  label: string;
  icon:
    | 'dashboard'
    | 'analysis'
    | 'reports'
    | 'settings'
    | 'prompts'
    | 'employees'
    | 'products'
    | 'forecast'
    | 'events'
    | 'catalog'
    | 'menu'
    | 'audit';
}> = [
  { id: 'ai-agent', label: 'AI Agent', icon: 'prompts' },
  { id: 'overview', label: 'Overview', icon: 'analysis' },
  { id: 'department-hr', label: 'HR', icon: 'employees' },
  { id: 'department-product', label: 'Product', icon: 'products' },
  { id: 'department-finance', label: 'Finance', icon: 'forecast' },
  { id: 'department-marketing', label: 'Marketing', icon: 'events' },
  { id: 'department-inventory', label: 'Inventory', icon: 'catalog' },
  { id: 'department-cfa', label: 'Chick-fil-A', icon: 'menu' },
  { id: 'audit-log', label: 'Audit Log', icon: 'audit' },
  { id: 'access-control', label: 'Access Control', icon: 'settings' }
];

const DEPARTMENT_TABS: Array<{ id: ExecutiveTabId; department: string }> = [
  { id: 'department-hr', department: 'HR' },
  { id: 'department-product', department: 'Product' },
  { id: 'department-finance', department: 'Finance' },
  { id: 'department-marketing', department: 'Marketing' },
  { id: 'department-inventory', department: 'Inventory' },
  { id: 'department-cfa', department: 'Chick-fil-A' }
];

const DEPARTMENT_PAGE_LINKS: Record<string, string> = {
  HR: '/hr',
  Product: '/product',
  Finance: '/finance',
  Marketing: '/marketing',
  Inventory: '/inventory',
  'Chick-fil-A': '/cfa',
  Executive: '/executive'
};

function resolveDepartmentHref(department: string): string {
  return DEPARTMENT_PAGE_LINKS[department] ?? '/executive';
}

const SUMMARY_CARD_LINKS: Record<string, string> = {
  'orders-week': '/product',
  'split-attendance-rate': '/hr?module=hr&tab=shift-attendance',
  'morning-shift-recent': '/hr?module=hr&tab=shift-attendance',
  'morning-meeting-recent': '/hr?module=hr&tab=meeting-attendance',
  'meeting-under-fifty': '/hr?module=hr&tab=meeting-attendance',
  'open-hr-requests': '/hr?module=hr&tab=requests',
  'finance-reports': '/finance',
  'inventory-sessions': '/inventory',
  'marketing-events': '/marketing',
  'cfa-logs': '/cfa',
  'calendar-upcoming': '/executive'
};

function resolveSummaryCardHref(cardId: string): string {
  return SUMMARY_CARD_LINKS[cardId] ?? '/executive';
}

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

function renderInlineMessageText(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`bold-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-[0.95em]" key={`code-${index}`}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
}

function renderMessageContent(content: string): ReactNode[] {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let keyIndex = 0;

  const flushBullets = () => {
    if (!bulletBuffer.length) return;
    nodes.push(
      <ul className="list-disc space-y-1 pl-5" key={`list-${keyIndex++}`}>
        {bulletBuffer.map((item, idx) => (
          <li key={`item-${idx}`}>{renderInlineMessageText(item)}</li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch?.[1]) {
      bulletBuffer.push(bulletMatch[1]);
      continue;
    }

    flushBullets();
    if (!trimmed) {
      nodes.push(<div className="h-2" key={`gap-${keyIndex++}`} />);
      continue;
    }

    nodes.push(
      <p className="whitespace-pre-wrap" key={`line-${keyIndex++}`}>
        {renderInlineMessageText(line)}
      </p>
    );
  }

  flushBullets();
  return nodes;
}

function formatProvenanceTooltip(provenance: unknown): string {
  if (!provenance || typeof provenance !== 'object') return '';
  const payload = provenance as {
    sourceTables?: unknown;
    window?: unknown;
    filters?: unknown;
    rowCounts?: unknown;
    toolIds?: unknown;
    validationStatus?: unknown;
  };

  const sourceTables = Array.isArray(payload.sourceTables) ? payload.sourceTables.map(String).join(', ') : 'none';
  const toolIds = Array.isArray(payload.toolIds) ? payload.toolIds.map(String).join(', ') : 'none';
  const validation = typeof payload.validationStatus === 'string' ? payload.validationStatus : 'not_applicable';
  const rowCounts =
    payload.rowCounts && typeof payload.rowCounts === 'object'
      ? Object.entries(payload.rowCounts as Record<string, unknown>)
          .map(([key, value]) => `${key}:${String(value)}`)
          .join(', ')
      : 'none';

  const windowText =
    Array.isArray(payload.window) && payload.window.length
      ? payload.window
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return '';
            const row = entry as { table?: unknown; column?: unknown; from?: unknown; to?: unknown };
            return `${String(row.table ?? 'unknown')}:${String(row.column ?? 'n/a')}:${String(row.from ?? 'n/a')}->${String(row.to ?? 'n/a')}`;
          })
          .filter(Boolean)
          .join('; ')
      : 'none';

  const filtersText =
    Array.isArray(payload.filters) && payload.filters.length
      ? payload.filters
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return '';
            const row = entry as { table?: unknown; filters?: unknown };
            const filterList = Array.isArray(row.filters)
              ? row.filters
                  .map((filter) => {
                    if (!filter || typeof filter !== 'object') return '';
                    const item = filter as { column?: unknown; op?: unknown };
                    return `${String(item.column ?? 'unknown')}:${String(item.op ?? 'eq')}`;
                  })
                  .filter(Boolean)
                  .join(',')
              : '';
            return `${String(row.table ?? 'unknown')}[${filterList}]`;
          })
          .filter(Boolean)
          .join('; ')
      : 'none';

  return [
    `source_tables: ${sourceTables}`,
    `window: ${windowText}`,
    `filters: ${filtersText}`,
    `row_counts: ${rowCounts}`,
    `tool_ids: ${toolIds}`,
    `validation: ${validation}`
  ].join('\n');
}

function stripLegacyProvenanceBlock(text: string): string {
  return text.replace(/\n*\[provenance\][\s\S]*$/i, '').trim();
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function ExpandableText({
  text,
  limit = 280,
  className = 'text-sm text-neutral-700',
  stopPropagationOnToggle = false
}: {
  text: string;
  limit?: number;
  className?: string;
  stopPropagationOnToggle?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > limit;
  const visibleText = expanded || !isLong ? text : `${text.slice(0, limit).trim()}...`;

  return (
    <div>
      <p className={className}>{visibleText}</p>
      {isLong ? (
        <button
          className="mt-2 min-h-[32px] border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          onClick={(event) => {
            if (stopPropagationOnToggle) event.stopPropagation();
            setExpanded((current) => !current);
          }}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function DepartmentOverviewGrid({
  items,
  emptyText = 'No department overview available yet.'
}: {
  items: DepartmentHealthItem[];
  emptyText?: string;
}) {
  const router = useRouter();

  if (!items.length) return <p className="text-sm text-neutral-700">{emptyText}</p>;

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const href = resolveDepartmentHref(item.department);
        return (
          <article
            className={`cursor-pointer border p-3 transition hover:shadow-sm ${healthClass(item.status)}`}
            key={item.id}
            onClick={() => router.push(href)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                router.push(href);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-neutral-900">{item.department}</p>
              <span className="text-[11px] uppercase tracking-wide text-neutral-600">{item.status}</span>
            </div>
            <div className="mt-2">
              <ExpandableText className="text-sm text-neutral-700" limit={260} stopPropagationOnToggle text={item.summary} />
            </div>
            <p className="mt-2 text-xs font-medium text-neutral-700 underline">Open {item.department} dashboard</p>
          </article>
        );
      })}
    </section>
  );
}

export function ExecutiveDashboard() {
  const [activeTab, setActiveTab] = useState<ExecutiveTabId>('ai-agent');

  const canViewExecutiveAiV2 = usePermission('executive.ai:view:own');
  const canViewExecutiveAiLegacy = usePermission('executive.ai_agent.view');
  const canViewExecutiveOverviewV2 = usePermission('executive.overview:view:all');
  const canViewExecutiveOverviewLegacy = usePermission('executive.overview.view');
  const canViewExecutiveAccessControlV2 = usePermission('executive.access:view:all');
  const canManageExecutiveAccessControlV2 = usePermission('executive.access:manage:all');
  const canViewExecutiveAccessControl = usePermission('executive.access_control.view');
  const canEditExecutiveAccessControl = usePermission('executive.access_control.edit');
  const canViewHrSchedule = usePermission('hr.schedule.view');
  const canViewHrAttendance = usePermission('hr.attendance.view');
  const canViewProductOrders = usePermission('product.orders.view');
  const canViewProductProducts = usePermission('product.products.view');
  const canViewFinanceReports = usePermission('finance.reports.view');
  const canViewFinanceUpload = usePermission('finance.upload.view');
  const canViewMarketingEvents = usePermission('marketing.events.view');
  const canViewMarketingReports = usePermission('marketing.reports.view');
  const canViewInventoryCatalog = usePermission('inventory.catalog.view');
  const canViewInventorySessions = usePermission('inventory.sessions.view');
  const canViewCfa = usePermission('cfa.logs.read');

  const canViewHr = canViewHrSchedule || canViewHrAttendance;
  const canViewProduct = canViewProductOrders || canViewProductProducts;
  const canViewFinance = canViewFinanceReports || canViewFinanceUpload;
  const canViewMarketing = canViewMarketingEvents || canViewMarketingReports;
  const canViewInventory = canViewInventoryCatalog || canViewInventorySessions;
  const canViewExecutiveAi = canViewExecutiveAiV2 || canViewExecutiveAiLegacy;
  const canViewExecutiveOverview = canViewExecutiveOverviewV2 || canViewExecutiveOverviewLegacy;
  const canViewAccessControl =
    canViewExecutiveAccessControlV2 ||
    canManageExecutiveAccessControlV2 ||
    canViewExecutiveAccessControl ||
    canEditExecutiveAccessControl;
  const departmentTabAccess = useMemo<Record<ExecutiveTabId, boolean>>(
    () => ({
      'ai-agent': canViewExecutiveAi,
      overview: canViewExecutiveOverview,
      'department-hr': canViewHr,
      'department-product': canViewProduct,
      'department-finance': canViewFinance,
      'department-marketing': canViewMarketing,
      'department-inventory': canViewInventory,
      'department-cfa': canViewCfa,
      'audit-log': canViewAccessControl,
      'access-control': canViewAccessControl
    }),
    [
      canViewExecutiveAi,
      canViewExecutiveOverview,
      canViewAccessControl,
      canViewCfa,
      canViewFinance,
      canViewHr,
      canViewInventory,
      canViewMarketing,
      canViewProduct
    ]
  );

  const navTabs = useMemo(
    () =>
      EXECUTIVE_TABS.filter((tab) => departmentTabAccess[tab.id]),
    [departmentTabAccess]
  );
  const firstAllowedTab: ExecutiveTabId = navTabs[0]?.id ?? 'ai-agent';
  const activeLabel = useMemo(
    () => navTabs.find((tab) => tab.id === activeTab)?.label ?? 'Executive Dashboard',
    [activeTab, navTabs]
  );

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
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const currentRequestControllerRef = useRef<AbortController | null>(null);
  const draftSessionIdRef = useRef<string | null>(null);

  const loadOverview = useCallback(async () => {
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
  }, []);

  const loadMessagesForSession = useCallback(async (currentUserKey: string, sessionId: string) => {
    if (!currentUserKey || !sessionId) return;
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams({ userKey: currentUserKey, sessionId });
      const response = await fetch(`/api/executive/history/messages?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        ok: boolean;
        messages?: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          metadata?: { provenance?: unknown };
        }>;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to load messages.');
      }
      const loadedMessages: ChatMessage[] =
        payload.messages?.map((message) => ({
          id: message.id,
          role: message.role,
          content: stripLegacyProvenanceBlock(message.content),
          pending: false,
          provenance: message.metadata?.provenance
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
  }, []);

  const loadSessions = useCallback(async (currentUserKey: string, preferredSessionId?: string) => {
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
      const draftSessionId = draftSessionIdRef.current;
      const shouldPreserveDraft =
        !preferredSessionId &&
        Boolean(draftSessionId) &&
        activeSessionId === draftSessionId &&
        !nextSessions.some((session) => session.sessionId === draftSessionId);

      if (shouldPreserveDraft && draftSessionId) {
        setSessions((current) => {
          const draftSession = current.find((session) => session.sessionId === draftSessionId) ?? {
            sessionId: draftSessionId,
            updatedAt: new Date().toISOString(),
            lastMessagePreview: 'New conversation',
            messageCount: 0
          };
          return [draftSession, ...nextSessions];
        });
        return;
      }

      setSessions(nextSessions);

      const preferred =
        preferredSessionId && nextSessions.some((session) => session.sessionId === preferredSessionId)
          ? preferredSessionId
          : '';
      if (preferred) {
        draftSessionIdRef.current = null;
      }
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
  }, [activeSessionId, loadMessagesForSession]);

  const scrollChatToBottom = useCallback((force = false) => {
    const container = chatScrollRef.current;
    if (!container) return;
    if (!force && !shouldStickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= CHAT_STICKY_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

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
  }, [userKey, loadSessions]);

  const allowedDepartmentNames = useMemo(() => {
    const allowed = new Set<string>();
    if (canViewHr) allowed.add('HR');
    if (canViewProduct) allowed.add('Product');
    if (canViewFinance) allowed.add('Finance');
    if (canViewMarketing) allowed.add('Marketing');
    if (canViewInventory) allowed.add('Inventory');
    if (canViewCfa) allowed.add('Chick-fil-A');
    return allowed;
  }, [canViewCfa, canViewFinance, canViewHr, canViewInventory, canViewMarketing, canViewProduct]);
  const departmentOverviews = useMemo(
    () =>
      uniqueBy(
        (overview?.departmentHealth ?? []).filter((item) => allowedDepartmentNames.has(item.department)),
        (item) => item.department
      ),
    [allowedDepartmentNames, overview]
  );
  const selectedDepartment = useMemo(
    () => DEPARTMENT_TABS.find((tab) => tab.id === activeTab)?.department ?? null,
    [activeTab]
  );

  useEffect(() => {
    if (!sending || !activeBreadcrumbs.length) return;
    const timer = window.setInterval(() => {
      setBreadcrumbIndex((current) => (current + 1) % activeBreadcrumbs.length);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [sending, activeBreadcrumbs]);

  useEffect(() => {
    if (!departmentTabAccess[activeTab]) {
      setActiveTab(firstAllowedTab);
    }
  }, [activeTab, departmentTabAccess, firstAllowedTab]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      scrollChatToBottom();
    });
  }, [messages, scrollChatToBottom]);

  useEffect(() => {
    if (loadingMessages) return;
    shouldStickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      scrollChatToBottom(true);
    });
  }, [loadingMessages, scrollChatToBottom]);

  const startNewConversation = () => {
    const newSessionId = createSessionId();
    shouldStickToBottomRef.current = true;
    draftSessionIdRef.current = newSessionId;
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
    shouldStickToBottomRef.current = true;
    draftSessionIdRef.current = null;
    setActiveSessionId(sessionId);
    await loadMessagesForSession(userKey, sessionId);
  };

  const deleteSession = async (sessionId: string) => {
    if (!userKey || deletingSessionId || sending) return;
    setDeletingSessionId(sessionId);
    try {
      const params = new URLSearchParams({ userKey, sessionId });
      const response = await fetch(`/api/executive/history/sessions?${params.toString()}`, {
        method: 'DELETE'
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to delete conversation.');
      }

      if (activeSessionId === sessionId) {
        setActiveSessionId('');
        setMessages([]);
      }
      await loadSessions(userKey);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `delete-session-error-${Date.now()}`,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Failed to delete conversation.',
          pending: false
        }
      ]);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const cancelCurrentRequest = useCallback(() => {
    currentRequestControllerRef.current?.abort();
  }, []);

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
    shouldStickToBottomRef.current = true;
    setMessages([...snapshot, userMessage, pendingAssistant]);
    setInput('');
    setSending(true);

    const planned = planExecutiveTools(trimmed).map((tool) => tool.runningText);
    setActiveBreadcrumbs(planned);
    setBreadcrumbIndex(0);
    let assistantText = '';
    let assistantProvenance: unknown = null;
    let finalSessionId = workingSessionId;
    const controller = new AbortController();
    currentRequestControllerRef.current = controller;

    try {
      const response = await fetch('/api/executive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          conversation: toConversation(snapshot),
          userKey,
          sessionId: workingSessionId,
          stream: true
        })
      });

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!response.ok) {
        let message = 'Chat request failed.';
        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error ?? message;
        } catch {
          // Ignore parse errors.
        }
        throw new Error(message);
      }

      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Streaming response was unavailable.');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let eventName = 'message';

        const processEventBlock = (block: string) => {
          const lines = block.split('\n');
          const dataLines: string[] = [];
          eventName = 'message';
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
              continue;
            }
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (dataLines.length === 0) return;
          try {
            const payload = JSON.parse(dataLines.join('\n')) as {
              text?: string;
              sessionId?: string;
              assistantMessage?: string;
              provenance?: unknown;
              error?: string;
            };
            if (eventName === 'delta' && typeof payload.text === 'string') {
              assistantText += payload.text;
              setMessages((current) =>
                current.map((message) =>
                  message.id === pendingAssistantId
                    ? {
                        ...message,
                        pending: true,
                        content: assistantText
                      }
                    : message
                )
              );
            } else if (eventName === 'done') {
              finalSessionId = payload.sessionId ?? finalSessionId;
              if (typeof payload.assistantMessage === 'string' && payload.assistantMessage.trim()) {
                assistantText = payload.assistantMessage;
              }
              assistantProvenance = payload.provenance ?? assistantProvenance;
            } else if (eventName === 'error') {
              throw new Error(payload.error ?? 'Streaming failed.');
            }
          } catch (error) {
            throw error instanceof Error ? error : new Error('Failed to parse streaming event.');
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const eventBlock of events) {
            if (!eventBlock.trim()) continue;
            processEventBlock(eventBlock);
          }
        }
        if (buffer.trim()) {
          processEventBlock(buffer);
        }
      } else {
        const payload = (await response.json()) as {
          ok: boolean;
          assistantMessage?: string;
          sessionId?: string;
          provenance?: unknown;
          error?: string;
        };
        if (!payload.ok) {
          throw new Error(payload.error ?? 'Chat request failed.');
        }
        assistantText = payload.assistantMessage ?? 'No response generated.';
        assistantText = stripLegacyProvenanceBlock(assistantText);
        finalSessionId = payload.sessionId ?? finalSessionId;
        assistantProvenance = payload.provenance ?? null;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                pending: false,
                content: stripLegacyProvenanceBlock(assistantText || 'No response generated.'),
                provenance: assistantProvenance
              }
            : message
        )
      );

      setActiveSessionId(finalSessionId);
      draftSessionIdRef.current = null;
      await loadSessions(userKey, finalSessionId);
      void loadOverview();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  pending: false,
                  content: assistantText.trim() ? `${assistantText}\n\n[Stopped]` : 'Stopped.'
                }
              : message
          )
        );
        return;
      }
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
      currentRequestControllerRef.current = null;
    }
  };

  const activeBreadcrumb = activeBreadcrumbs[breadcrumbIndex] ?? '';

  if (navTabs.length === 0) {
    return (
      <main className="p-4 text-sm text-neutral-700">
        You do not have permission to view any executive sections.
      </main>
    );
  }

  return (
    <DepartmentShell
      activeNavId={activeTab}
      contentHeading={activeLabel}
      departmentIcon="dashboard"
      navAriaLabel="Executive dashboard navigation"
      navItems={navTabs}
      onNavSelect={(id) => setActiveTab(id as ExecutiveTabId)}
      subtitle="Cross-department intelligence with AI-assisted executive operations"
      title="Executive Dashboard"
    >
      <section className="w-full border-x border-b border-neutral-300 bg-white">
        {activeTab === 'ai-agent' ? (
          <section className="flex h-[calc(100dvh-76px)] min-h-[720px] w-full overflow-hidden">
            {historyOpen ? (
              <aside className="flex w-full max-w-[260px] flex-col border-r border-neutral-200 bg-white p-3">
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
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {loadingSessions ? <p className="text-xs text-neutral-600">Loading sessions...</p> : null}
                  {!loadingSessions && sessions.length === 0 ? (
                    <p className="text-xs text-neutral-600">No saved conversations yet.</p>
                  ) : null}
                  {sessions.map((session) => {
                    const isActive = session.sessionId === activeSessionId;
                    const isDeleting = deletingSessionId === session.sessionId;
                    return (
                      <article
                        className={`group w-full border p-2 transition-colors ${
                          isActive ? 'border-brand-maroon bg-[#fff5f5]' : 'border-neutral-300 bg-white'
                        }`}
                        key={session.sessionId}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            className={`min-w-0 flex-1 text-left transition-transform duration-200 ${
                              !isActive ? 'hover:bg-neutral-100' : ''
                            } group-hover:-translate-x-0.5 group-focus-within:-translate-x-0.5`}
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
                          <button
                            aria-label="Delete conversation"
                            className="mt-0.5 inline-flex h-6 w-6 shrink-0 translate-x-1 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-600 opacity-0 transition-all duration-200 hover:text-neutral-900 focus-visible:opacity-100 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 disabled:opacity-50"
                            disabled={Boolean(deletingSessionId) || sending}
                            onClick={() => void deleteSession(session.sessionId)}
                            title="Delete conversation"
                            type="button"
                          >
                            {isDeleting ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-neutral-500 border-t-transparent" />
                            ) : (
                              <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                <path
                                  d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="1.8"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <button
                  className="mt-3 min-h-[30px] w-full border border-neutral-300 bg-white px-2 text-xs hover:bg-neutral-100"
                  onClick={() => setHistoryOpen(false)}
                  type="button"
                >
                  Hide History
                </button>
              </aside>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between gap-2 px-4 pt-3">
                <h2 className="text-sm font-semibold text-neutral-800">Executive AI Agent</h2>
                {!historyOpen ? (
                  <button
                    className="min-h-[30px] border border-neutral-300 bg-white px-2 text-xs hover:bg-neutral-100"
                    onClick={() => setHistoryOpen(true)}
                    type="button"
                  >
                    Show History
                  </button>
                ) : null}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-2" onScroll={handleChatScroll} ref={chatScrollRef}>
                <div className="mx-auto w-full max-w-5xl space-y-6">
                  {!loadingMessages && messages.length === 0 ? (
                    <section className="space-y-4 py-16 text-center">
                      <h3 className="text-3xl font-semibold tracking-tight text-neutral-900">Executive AI Agent</h3>
                      <p className="mx-auto max-w-xl text-sm text-neutral-600">
                        Ask one question to get cross-department insights from Product, HR, Inventory, Marketing,
                        Finance, and CFA.
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
                        {message.role === 'assistant' && !message.pending && message.provenance ? (
                          <div className="mb-1 flex justify-end">
                            <span
                              className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-neutral-300 bg-neutral-50 text-[11px] text-neutral-600"
                              title={formatProvenanceTooltip(message.provenance)}
                            >
                              i
                            </span>
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          {message.content ? <div className="space-y-1">{renderMessageContent(message.content)}</div> : null}
                          {message.pending ? (
                            <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:120ms]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:240ms]" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="border-t border-neutral-200 bg-white px-4 py-4">
                <div className="mx-auto w-full max-w-5xl">
                  {sending && activeBreadcrumb ? (
                    <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                      <span>{activeBreadcrumb}</span>
                    </div>
                  ) : null}

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (sending) {
                        cancelCurrentRequest();
                        return;
                      }
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
                            if (sending) {
                              cancelCurrentRequest();
                              return;
                            }
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
                          disabled={loadingMessages || (!sending && !input.trim())}
                          type="submit"
                        >
                          {sending ? 'Stop' : 'Send'}
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
                  <div className="mt-2">
                    <ExpandableText limit={420} text={overview.executiveBrief} />
                  </div>
                </section>
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {overview.summaryCards.map((card) => (
                    <Link
                      className={`block border p-3 transition hover:shadow-sm ${toneClass(card.tone)}`}
                      href={resolveSummaryCardHref(card.id)}
                      key={card.id}
                    >
                      <p className="text-xs uppercase tracking-wide text-neutral-500">{card.title}</p>
                      <p className="mt-1 text-2xl font-semibold text-neutral-900">{card.value}</p>
                      <p className="mt-1 text-xs text-neutral-700">{card.subtitle}</p>
                      <p className="mt-2 text-xs font-medium text-neutral-700 underline">Open details</p>
                    </Link>
                  ))}
                </section>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-neutral-900">Department Overviews</h3>
                    <p className="text-sm text-neutral-600">
                      High-level status by department with quick navigation to each module.
                    </p>
                  </div>
                  <DepartmentOverviewGrid items={departmentOverviews} />
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {selectedDepartment ? (
          <section className="mx-auto w-full max-w-[1100px] space-y-4 p-4 md:p-6">
            {loadingOverview ? <p className="text-sm text-neutral-700">Loading executive overview...</p> : null}
            {overviewError ? <p className="text-sm text-red-700">{overviewError}</p> : null}
            {overview ? (
              <>
                <section className="border border-neutral-300 bg-white p-4">
                  <h2 className="text-lg font-semibold">{selectedDepartment} Updates</h2>
                  <p className="mt-1 text-xs text-neutral-600">
                    Focused important updates for {selectedDepartment}.
                  </p>
                  <div className="mt-2">
                    <ExpandableText
                      limit={420}
                      text={
                        overview.departmentHealth.find((item) => item.department === selectedDepartment)?.summary ??
                        `No health summary available yet for ${selectedDepartment}.`
                      }
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-900">Recent Feed</h3>
                  {overview.feed
                    .filter((item) => item.department === selectedDepartment)
                    .slice(0, 8)
                    .map((item) => (
                      <article className="border border-neutral-300 bg-white p-3" key={item.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                          <p className="text-xs text-neutral-600">{item.timestamp}</p>
                        </div>
                        <div className="mt-1">
                          <ExpandableText className="text-sm text-neutral-700" limit={300} text={item.detail} />
                        </div>
                        <Link className="mt-2 inline-flex text-xs underline" href={item.href}>
                          Open source module
                        </Link>
                      </article>
                    ))}
                  {!overview.feed.some((item) => item.department === selectedDepartment) ? (
                    <p className="text-sm text-neutral-700">No recent feed updates.</p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-900">Alerts</h3>
                  {overview.alerts
                    .filter((alert) => alert.department === selectedDepartment)
                    .map((alert) => (
                      <article className="border border-neutral-300 bg-white p-3" key={alert.id}>
                        <p className="text-sm font-semibold text-neutral-900">{alert.title}</p>
                        <p className="mt-1 text-sm text-neutral-700">{alert.description}</p>
                        <p className="mt-2 text-xs text-neutral-600">Next step: {alert.action}</p>
                      </article>
                    ))}
                  {!overview.alerts.some((alert) => alert.department === selectedDepartment) ? (
                    <p className="text-sm text-neutral-700">No active alerts for this department.</p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-900">Reports</h3>
                  {overview.reports
                    .filter((report) => report.type === selectedDepartment)
                    .slice(0, 6)
                    .map((report) => (
                      <article className="border border-neutral-300 bg-white p-3" key={report.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-neutral-900">{report.title}</p>
                          <p className="text-xs text-neutral-600">{report.updatedAt}</p>
                        </div>
                        <p className="mt-1 text-xs text-neutral-600">
                          Status: {report.status} | Owner: {report.owner}
                        </p>
                        <Link className="mt-2 inline-flex text-xs underline" href={report.href}>
                          Open source module
                        </Link>
                      </article>
                    ))}
                  {!overview.reports.some((report) => report.type === selectedDepartment) ? (
                    <p className="text-sm text-neutral-700">No recent reports for this department.</p>
                  ) : null}
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'access-control' && canViewAccessControl ? (
          <section className="w-full space-y-4 p-4 md:p-6">
            <div className="border border-neutral-300 bg-white">
              <AccessControlTab />
            </div>
          </section>
        ) : null}

        {activeTab === 'audit-log' && canViewAccessControl ? (
          <section className="w-full space-y-4 p-4 md:p-6">
            <ExecutiveAuditLog />
          </section>
        ) : null}
      </section>
    </DepartmentShell>
  );
}
