'use client';

import { useEffect, useMemo, useState } from 'react';

import { addStrike, removeStrike } from '@/app/actions/strikes';

type CheckSignup = {
  id: string;
  employee_id: number;
  employee_s_number: string;
  signup_status: 'signed_up' | 'withdrawn';
  attendance_status: 'expected' | 'present' | 'absent' | 'excused';
  attendance_reason: string | null;
};

type CheckRequest = {
  id: string;
  employee_id: number;
  employee_s_number: string;
  request_type: 'add' | 'drop';
  status: 'pending' | 'approved' | 'denied';
  reason: string;
  requested_at: string;
};

type InventoryCheck = {
  id: string;
  title?: string;
  starts_at: string;
  ends_at: string | null;
  signup_state?: string;
  roster?: CheckSignup[];
  requests?: CheckRequest[];
};

type Analytics = {
  totalChecks: number;
  totalSignups: number;
  totalPresent: number;
  totalAbsent: number;
  totalExcused: number;
  attendanceRate: number;
  noShowRate: number;
  excusedRate: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

export function InventoryAttendanceTab() {
  const [checks, setChecks] = useState<InventoryCheck[]>([]);
  const [selectedCheckId, setSelectedCheckId] = useState('');
  const [status, setStatus] = useState<string>('');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newEmployeeSNumber, setNewEmployeeSNumber] = useState('');
  const [strikeBySignupId, setStrikeBySignupId] = useState<Record<string, string>>({});

  const load = async () => {
    const [checksPayload, analyticsPayload] = await Promise.all([
      fetchJson<{ ok: true; checks: InventoryCheck[] }>('/api/inventory/checks?includeRoster=1&includeRequests=1'),
      fetchJson<{ ok: true; analytics: Analytics }>('/api/inventory/checks/analytics')
    ]);
    setChecks(checksPayload.checks);
    setAnalytics(analyticsPayload.analytics);
    if (!selectedCheckId && checksPayload.checks.length > 0) {
      setSelectedCheckId(checksPayload.checks[0].id);
    }
  };

  useEffect(() => {
    void load().catch((error) => setStatus(error instanceof Error ? error.message : 'Unable to load attendance data.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCheck = useMemo(
    () => checks.find((check) => check.id === selectedCheckId) ?? null,
    [checks, selectedCheckId]
  );

  const activeRoster = useMemo(() => {
    return (selectedCheck?.roster ?? []).filter((row) => row.signup_status === 'signed_up');
  }, [selectedCheck?.roster]);

  const setAttendance = async (
    employeeId: number,
    employeeSNumber: string,
    attendanceStatus: 'expected' | 'present' | 'absent' | 'excused'
  ) => {
    if (!selectedCheckId) return;
    await fetchJson(`/api/inventory/checks/${selectedCheckId}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_attendance',
        employee_id: employeeId,
        employee_s_number: employeeSNumber,
        attendance_status: attendanceStatus
      })
    });
    await load();
    setStatus('Attendance updated.');
  };

  const addEmployee = async () => {
    if (!selectedCheckId) return;
    const employeeId = Number(newEmployeeId);
    if (!Number.isFinite(employeeId) || !newEmployeeSNumber.trim()) {
      setStatus('Provide both employee ID and s_number.');
      return;
    }

    await fetchJson(`/api/inventory/checks/${selectedCheckId}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_employee',
        employee_id: employeeId,
        employee_s_number: newEmployeeSNumber.trim()
      })
    });
    setNewEmployeeId('');
    setNewEmployeeSNumber('');
    await load();
    setStatus('Employee added to roster.');
  };

  const removeEmployee = async (employeeId: number, employeeSNumber: string) => {
    if (!selectedCheckId) return;
    await fetchJson(`/api/inventory/checks/${selectedCheckId}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'remove_employee',
        employee_id: employeeId,
        employee_s_number: employeeSNumber
      })
    });
    await load();
    setStatus('Employee removed from roster.');
  };

  const reviewRequest = async (requestId: string, nextStatus: 'approved' | 'denied') => {
    await fetchJson(`/api/inventory/checks/requests/${requestId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, excuse_if_started: true })
    });
    await load();
    setStatus(`Request ${nextStatus}.`);
  };

  const createStrikeForMiss = async (signup: CheckSignup) => {
    const reason = strikeBySignupId[signup.id]?.trim() || 'Missed inventory check';
    const result = await addStrike(String(signup.employee_id), reason, 'strike');
    if (!result.ok) throw new Error(result.error.message);
    setStatus('Strike added.');
  };

  const clearStrike = async (strikeId: string) => {
    const result = await removeStrike(strikeId);
    if (!result.ok) throw new Error(result.error.message);
    setStatus('Strike removed.');
  };

  return (
    <section className="space-y-4">
      <div className="border border-neutral-300 p-3">
        <h3 className="text-sm font-semibold text-neutral-900">Inventory Check Attendance</h3>
        <p className="mt-1 text-xs text-neutral-600">
          Manage roster, attendance, change requests, and strike actions for inventory checks.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="text-sm">
            Check
            <select
              className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
              onChange={(event) => setSelectedCheckId(event.target.value)}
              value={selectedCheckId}
            >
              <option value="">Select a check</option>
              {checks.map((check) => (
                <option key={check.id} value={check.id}>
                  {(check.title ?? 'Inventory Check')} - {new Date(check.starts_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        </div>
        {status ? <p className="mt-2 text-sm text-brand-maroon">{status}</p> : null}
      </div>

      {analytics ? (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="border border-neutral-300 p-3 text-sm">
            <p className="text-xs text-neutral-500">Checks</p>
            <p className="font-medium">{analytics.totalChecks}</p>
          </div>
          <div className="border border-neutral-300 p-3 text-sm">
            <p className="text-xs text-neutral-500">Total signups</p>
            <p className="font-medium">{analytics.totalSignups}</p>
          </div>
          <div className="border border-neutral-300 p-3 text-sm">
            <p className="text-xs text-neutral-500">Attendance rate</p>
            <p className="font-medium">{analytics.attendanceRate.toFixed(1)}%</p>
          </div>
          <div className="border border-neutral-300 p-3 text-sm">
            <p className="text-xs text-neutral-500">No-show rate</p>
            <p className="font-medium">{analytics.noShowRate.toFixed(1)}%</p>
          </div>
        </div>
      ) : null}

      {selectedCheck ? (
        <>
          <section className="border border-neutral-300 p-3">
            <h4 className="text-sm font-semibold text-neutral-900">Roster</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input
                className="border border-neutral-300 px-2 py-2 text-sm"
                onChange={(event) => setNewEmployeeId(event.target.value)}
                placeholder="Employee ID"
                value={newEmployeeId}
              />
              <input
                className="border border-neutral-300 px-2 py-2 text-sm"
                onChange={(event) => setNewEmployeeSNumber(event.target.value)}
                placeholder="Employee s_number"
                value={newEmployeeSNumber}
              />
              <button
                className="border border-brand-maroon bg-brand-maroon px-3 py-2 text-sm text-white"
                onClick={() => {
                  void addEmployee().catch((error) =>
                    setStatus(error instanceof Error ? error.message : 'Unable to add employee.')
                  );
                }}
                type="button"
              >
                Add Employee
              </button>
            </div>
            <div className="mt-3 overflow-x-auto border border-neutral-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 px-2 py-1">Employee</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Attendance</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Roster</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Strike</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRoster.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-neutral-200 px-2 py-1">
                        #{row.employee_id} ({row.employee_s_number})
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          {(['present', 'absent', 'excused', 'expected'] as const).map((value) => (
                            <button
                              className={`border px-2 py-1 ${row.attendance_status === value ? 'border-brand-maroon bg-brand-maroon text-white' : 'border-neutral-300'}`}
                              key={value}
                              onClick={() => {
                                void setAttendance(row.employee_id, row.employee_s_number, value).catch((error) =>
                                  setStatus(error instanceof Error ? error.message : 'Unable to set attendance.')
                                );
                              }}
                              type="button"
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-1">
                        <button
                          className="border border-neutral-400 px-2 py-1"
                          onClick={() => {
                            void removeEmployee(row.employee_id, row.employee_s_number).catch((error) =>
                              setStatus(error instanceof Error ? error.message : 'Unable to remove employee.')
                            );
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      </td>
                      <td className="border-b border-neutral-200 px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          <input
                            className="border border-neutral-300 px-2 py-1"
                            onChange={(event) =>
                              setStrikeBySignupId((prev) => ({ ...prev, [row.id]: event.target.value }))
                            }
                            placeholder="Strike reason"
                            value={strikeBySignupId[row.id] ?? ''}
                          />
                          <button
                            className="border border-red-700 bg-red-700 px-2 py-1 text-white"
                            onClick={() => {
                              void createStrikeForMiss(row).catch((error) =>
                                setStatus(error instanceof Error ? error.message : 'Unable to add strike.')
                              );
                            }}
                            type="button"
                          >
                            Strike
                          </button>
                          <button
                            className="border border-neutral-500 px-2 py-1"
                            onClick={() => {
                              const strikeId = window.prompt('Enter strike id to remove');
                              if (!strikeId) return;
                              void clearStrike(strikeId).catch((error) =>
                                setStatus(error instanceof Error ? error.message : 'Unable to remove strike.')
                              );
                            }}
                            type="button"
                          >
                            Remove Strike
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {activeRoster.length === 0 ? (
                    <tr>
                      <td className="px-2 py-2 text-neutral-600" colSpan={4}>
                        No active signups for this check.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border border-neutral-300 p-3">
            <h4 className="text-sm font-semibold text-neutral-900">Pending Change Requests</h4>
            <div className="mt-2 overflow-x-auto border border-neutral-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 px-2 py-1">Employee</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Type</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Reason</th>
                    <th className="border-b border-neutral-300 px-2 py-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedCheck.requests ?? [])
                    .filter((row) => row.status === 'pending')
                    .map((row) => (
                      <tr key={row.id}>
                        <td className="border-b border-neutral-200 px-2 py-1">{row.employee_s_number}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{row.request_type}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">{row.reason}</td>
                        <td className="border-b border-neutral-200 px-2 py-1">
                          <div className="flex gap-2">
                            <button
                              className="border border-brand-maroon bg-brand-maroon px-2 py-1 text-white"
                              onClick={() => {
                                void reviewRequest(row.id, 'approved').catch((error) =>
                                  setStatus(error instanceof Error ? error.message : 'Unable to approve request.')
                                );
                              }}
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="border border-neutral-400 px-2 py-1"
                              onClick={() => {
                                void reviewRequest(row.id, 'denied').catch((error) =>
                                  setStatus(error instanceof Error ? error.message : 'Unable to deny request.')
                                );
                              }}
                              type="button"
                            >
                              Deny
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {(selectedCheck.requests ?? []).filter((row) => row.status === 'pending').length === 0 ? (
                    <tr>
                      <td className="px-2 py-2 text-neutral-600" colSpan={4}>
                        No pending requests.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
