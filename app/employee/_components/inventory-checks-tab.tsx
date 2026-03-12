'use client';

import { useEffect, useMemo, useState } from 'react';

type SignupState = 'none' | 'signed_up' | 'withdrawn' | 'requested_change';

type CheckRow = {
  id: string;
  title?: string;
  starts_at: string;
  ends_at: string | null;
  details?: string | null;
  signup_state?: SignupState;
  can_self_withdraw?: boolean;
  own_signup?: {
    attendance_status: 'expected' | 'present' | 'absent' | 'excused';
    signup_status: 'signed_up' | 'withdrawn';
  } | null;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

export function InventoryChecksTab() {
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [status, setStatus] = useState('');
  const [requestReasonByCheck, setRequestReasonByCheck] = useState<Record<string, string>>({});

  const load = async () => {
    const payload = await fetchJson<{ ok: true; checks: CheckRow[] }>('/api/inventory/checks?includeRoster=1&includeRequests=1');
    setChecks(payload.checks);
  };

  useEffect(() => {
    void load().catch((error) => setStatus(error instanceof Error ? error.message : 'Unable to load checks.'));
  }, []);

  const upcomingChecks = useMemo(
    () => checks.filter((check) => new Date(check.starts_at).getTime() >= Date.now()),
    [checks]
  );
  const historyChecks = useMemo(
    () => checks.filter((check) => new Date(check.starts_at).getTime() < Date.now()),
    [checks]
  );

  const stats = useMemo(() => {
    const attended = historyChecks.filter((check) => check.own_signup?.attendance_status === 'present').length;
    const missed = historyChecks.filter((check) => check.own_signup?.attendance_status === 'absent').length;
    const excused = historyChecks.filter((check) => check.own_signup?.attendance_status === 'excused').length;
    const total = attended + missed + excused;
    return {
      attended,
      missed,
      excused,
      rate: total > 0 ? (attended / total) * 100 : 0
    };
  }, [historyChecks]);

  const signUp = async (checkId: string) => {
    await fetchJson(`/api/inventory/checks/${checkId}/signup`, { method: 'POST' });
    await load();
    setStatus('Signed up for inventory check.');
  };

  const withdraw = async (checkId: string) => {
    await fetchJson(`/api/inventory/checks/${checkId}/withdraw`, { method: 'POST' });
    await load();
    setStatus('Removed from inventory check.');
  };

  const requestChange = async (checkId: string, type: 'add' | 'drop') => {
    const reason = requestReasonByCheck[checkId]?.trim();
    if (!reason) {
      setStatus('Please provide a reason for your change request.');
      return;
    }
    await fetchJson(`/api/inventory/checks/${checkId}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_type: type, reason })
    });
    await load();
    setStatus('Change request submitted to inventory admin.');
  };

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-500">Attended</p>
          <p className="text-sm font-medium">{stats.attended}</p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-500">Missed</p>
          <p className="text-sm font-medium">{stats.missed}</p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-500">Excused</p>
          <p className="text-sm font-medium">{stats.excused}</p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-500">Attendance rate</p>
          <p className="text-sm font-medium">{stats.rate.toFixed(1)}%</p>
        </div>
      </div>

      {status ? <p className="text-sm text-brand-maroon">{status}</p> : null}

      <section className="border border-neutral-300">
        <header className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium">
          Upcoming Inventory Checks
        </header>
        <div className="divide-y divide-neutral-200">
          {upcomingChecks.map((check) => {
            const signedUp = check.signup_state === 'signed_up';
            return (
              <div className="space-y-2 p-3" key={check.id}>
                <p className="text-sm font-medium">{check.title ?? 'Inventory Check'}</p>
                <p className="text-xs text-neutral-600">{new Date(check.starts_at).toLocaleString()}</p>
                {check.details ? <p className="text-xs text-neutral-700">{check.details}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {!signedUp ? (
                    <button
                      className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white"
                      onClick={() => {
                        void signUp(check.id).catch((error) =>
                          setStatus(error instanceof Error ? error.message : 'Unable to sign up.')
                        );
                      }}
                      type="button"
                    >
                      Sign Up
                    </button>
                  ) : check.can_self_withdraw ? (
                    <button
                      className="min-h-[40px] border border-neutral-500 px-3 text-sm"
                      onClick={() => {
                        void withdraw(check.id).catch((error) =>
                          setStatus(error instanceof Error ? error.message : 'Unable to remove signup.')
                        );
                      }}
                      type="button"
                    >
                      Remove Myself
                    </button>
                  ) : (
                    <>
                      <p className="text-xs text-amber-700">
                        24-hour lock active. Submit a change request.
                      </p>
                      <input
                        className="min-h-[40px] min-w-64 border border-neutral-300 px-2 text-sm"
                        onChange={(event) =>
                          setRequestReasonByCheck((prev) => ({ ...prev, [check.id]: event.target.value }))
                        }
                        placeholder="Reason for request"
                        value={requestReasonByCheck[check.id] ?? ''}
                      />
                      <button
                        className="min-h-[40px] border border-neutral-500 px-3 text-sm"
                        onClick={() => {
                          void requestChange(check.id, signedUp ? 'drop' : 'add').catch((error) =>
                            setStatus(error instanceof Error ? error.message : 'Unable to submit request.')
                          );
                        }}
                        type="button"
                      >
                        Request Change
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {upcomingChecks.length === 0 ? (
            <p className="p-3 text-sm text-neutral-600">No upcoming inventory checks.</p>
          ) : null}
        </div>
      </section>

      <section className="border border-neutral-300">
        <header className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium">
          Inventory Check History
        </header>
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Check</th>
              <th className="border-b border-neutral-300 p-2 text-left">When</th>
              <th className="border-b border-neutral-300 p-2 text-left">Signup</th>
              <th className="border-b border-neutral-300 p-2 text-left">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {historyChecks.map((check) => (
              <tr className="border-b border-neutral-200" key={check.id}>
                <td className="p-2">{check.title ?? 'Inventory Check'}</td>
                <td className="p-2">{new Date(check.starts_at).toLocaleString()}</td>
                <td className="p-2">{check.own_signup?.signup_status ?? 'none'}</td>
                <td className="p-2">{check.own_signup?.attendance_status ?? '-'}</td>
              </tr>
            ))}
            {historyChecks.length === 0 ? (
              <tr>
                <td className="p-3 text-neutral-600" colSpan={4}>
                  No past inventory checks yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </section>
  );
}
