'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { markMeetingAbsent, overrideMeetingAttendance, pardonMeetingAbsence } from '@/app/actions/attendance';
import { fetchMeetingAttendance } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';

import { formatRate } from './utils';

export function MeetingAttendanceTab(props: { dateRange: { from: string; to: string } }) {
  const canView = usePermission('hr.attendance.view');
  const canOverride = usePermission('hr.attendance.override');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [meetingActionDraft, setMeetingActionDraft] = useState<{
    sNumber: string;
    name: string;
    mode: 'pardon' | 'present' | 'absent';
    date: string;
    reason: string;
  } | null>(null);
  const range = useMemo(() => props.dateRange, [props.dateRange]);

  const meetingQuery = useQuery({
    queryKey: ['hr-meeting-attendance', range],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const result = await fetchMeetingAttendance({ from: range.from, to: range.to });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const pardonMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await pardonMeetingAbsence(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatus('Meeting absence pardoned.');
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-attendance'] });
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : 'Unable to pardon meeting absence.')
  });

  const overrideMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await overrideMeetingAttendance(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatus('Meeting attendance overridden as present.');
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-attendance'] });
    },
    onError: (error) =>
      setStatus(error instanceof Error ? error.message : 'Unable to override meeting attendance.')
  });

  const markAbsentMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await markMeetingAbsent(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatus('Meeting marked absent (attendance row removed).');
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-attendance'] });
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : 'Unable to mark meeting absent.')
  });

  if (!canView) {
    return <p className="text-sm text-neutral-700">You do not have permission to view meeting attendance.</p>;
  }

  return (
    <section className="space-y-4">
      <p className="text-xs text-neutral-600">
        Meeting attendance is separate from period 0 morning shift attendance.
      </p>
      {status && <p className="text-sm text-brand-maroon">{status}</p>}
      {meetingQuery.isLoading && <p className="text-sm text-neutral-600">Loading meeting attendance...</p>}
      {meetingQuery.error && <p className="text-sm text-red-700">{(meetingQuery.error as Error).message}</p>}

      {meetingQuery.data && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Total students</p>
              <p className="text-sm font-medium">{meetingQuery.data.analytics.total_students}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Total sessions</p>
              <p className="text-sm font-medium">{meetingQuery.data.analytics.total_sessions}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Average attendance</p>
              <p className="text-sm font-medium">{formatRate(meetingQuery.data.analytics.avg_attendance)}</p>
            </div>
          </div>

          <div className="overflow-x-auto border border-neutral-300">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-100">
                <tr>
                  <th className="border-b border-neutral-300 p-2 text-left">Name</th>
                  <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Present</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Absent</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Raw</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Adjusted</th>
                  <th className="border-b border-neutral-300 p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {meetingQuery.data.analytics.students.map((student) => (
                  <tr className="border-b border-neutral-200" key={student.s_number}>
                    <td className="p-2">{student.name}</td>
                    <td className="p-2">{student.s_number}</td>
                    <td className="p-2">{student.present_count}</td>
                    <td className="p-2">{student.absent_count}</td>
                    <td className="p-2">{formatRate(student.raw_attendance_rate ?? student.attendance_rate)}</td>
                    <td className="p-2">{formatRate(student.adjusted_attendance_rate)}</td>
                    <td className="p-2">
                      {canOverride && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                            onClick={() => {
                              const date = meetingQuery.data?.dates[meetingQuery.data.dates.length - 1] ?? '';
                              setMeetingActionDraft({
                                sNumber: student.s_number,
                                name: student.name,
                                mode: 'pardon',
                                date,
                                reason: ''
                              });
                            }}
                            type="button"
                          >
                            Pardon
                          </button>
                          <button
                            className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                            onClick={() => {
                              const date = meetingQuery.data?.dates[meetingQuery.data.dates.length - 1] ?? '';
                              setMeetingActionDraft({
                                sNumber: student.s_number,
                                name: student.name,
                                mode: 'present',
                                date,
                                reason: ''
                              });
                            }}
                            type="button"
                          >
                            Mark Present
                          </button>
                          <button
                            className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                            onClick={() => {
                              const date = meetingQuery.data?.dates[meetingQuery.data.dates.length - 1] ?? '';
                              setMeetingActionDraft({
                                sNumber: student.s_number,
                                name: student.name,
                                mode: 'absent',
                                date,
                                reason: ''
                              });
                            }}
                            type="button"
                          >
                            Mark Absent
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {meetingActionDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg border border-neutral-400 bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">
              {meetingActionDraft.mode === 'pardon'
                ? 'Pardon Meeting Absence'
                : meetingActionDraft.mode === 'present'
                  ? 'Mark Meeting Present'
                  : 'Mark Meeting Absent'}
            </h3>
            <p className="mt-1 text-sm text-neutral-700">{meetingActionDraft.name}</p>
            <label className="mt-3 block text-sm">
              Meeting date
              <select
                className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                onChange={(event) =>
                  setMeetingActionDraft((previous) =>
                    previous ? { ...previous, date: event.target.value } : previous
                  )
                }
                value={meetingActionDraft.date}
              >
                {(meetingQuery.data?.dates ?? []).map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Reason
              <textarea
                className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
                onChange={(event) =>
                  setMeetingActionDraft((previous) =>
                    previous ? { ...previous, reason: event.target.value } : previous
                  )
                }
                value={meetingActionDraft.reason}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                onClick={() => setMeetingActionDraft(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-40"
                disabled={
                  !meetingActionDraft.date ||
                  ((meetingActionDraft.mode === 'pardon' || meetingActionDraft.mode === 'present') &&
                    !meetingActionDraft.reason.trim()) ||
                  pardonMutation.isPending ||
                  overrideMutation.isPending ||
                  markAbsentMutation.isPending
                }
                onClick={() => {
                  const payload = {
                    sNumber: meetingActionDraft.sNumber,
                    date: meetingActionDraft.date,
                    reason: meetingActionDraft.reason.trim()
                  };
                  if (meetingActionDraft.mode === 'pardon') {
                    pardonMutation.mutate(payload);
                  } else if (meetingActionDraft.mode === 'present') {
                    overrideMutation.mutate(payload);
                  } else {
                    markAbsentMutation.mutate(payload);
                  }
                  setMeetingActionDraft(null);
                }}
                type="button"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
