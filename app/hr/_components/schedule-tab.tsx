'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { buildExpectedShifts } from '@/app/actions/expected-shifts';
import { fetchSchedule } from '@/lib/api-client';
import { ScheduleAssignment } from '@/lib/types';

import { useBrowserSupabase } from './utils';

const ScheduleFormSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  anchorDate: z.string().min(10),
  anchorDay: z.enum(['A', 'B']),
  seed: z.number().int()
});

type ScheduleFormValues = z.infer<typeof ScheduleFormSchema>;

type CalendarDayCell = {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
};

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PERIOD_BANDS: Array<{ id: string; label: string; periods: number[] }> = [
  { id: 'morning', label: '8:20 - 9 AM', periods: [0] },
  { id: 'p1-5', label: 'Period 1 / 5', periods: [1, 5] },
  { id: 'p2-6', label: 'Period 2 / 6', periods: [2, 6] },
  { id: 'p3-7', label: 'Period 3 / 7', periods: [3, 7] },
  { id: 'p4-8', label: 'Period 4 / 8', periods: [4, 8] }
];

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildMonthWeeks(year: number, month: number): CalendarDayCell[][] {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - monthStart.getUTCDay());

  const gridEnd = new Date(monthEnd);
  gridEnd.setUTCDate(monthEnd.getUTCDate() + (6 - monthEnd.getUTCDay()));

  const days: CalendarDayCell[] = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push({
      dateKey: toDateKey(cursor),
      dayNumber: cursor.getUTCDate(),
      inCurrentMonth: cursor.getUTCMonth() + 1 === month
    });
  }

  const weeks: CalendarDayCell[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

function getDefaultValues(): ScheduleFormValues {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    anchorDate: now.toISOString().slice(0, 10),
    anchorDay: 'A',
    seed: Number(`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
  };
}

export function ScheduleTab() {
  const defaultValues = useMemo(() => getDefaultValues(), []);
  const [params, setParams] = useState(defaultValues);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(ScheduleFormSchema),
    defaultValues
  });

  const scheduleQuery = useQuery({
    queryKey: ['hr-schedule', params],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const result = await fetchSchedule(params);
      if (!result.ok) {
        throw new Error(`${result.error.message} (${result.correlationId})`);
      }
      return result.data;
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['employee-settings-for-schedule'],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_settings').select('employee_s_number, off_periods');
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const manualRefresh = useMutation({
    mutationFn: async () => {
      const result = await fetchSchedule({ ...params, forceRefresh: true });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['hr-schedule', params], data);
      setMessage('Schedule refreshed from live API.');
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh schedule.');
    }
  });

  const buildExpectedMutation = useMutation({
    mutationFn: async () => {
      const result = await buildExpectedShifts(params.year, params.month, {
        forceRebuild: true,
        anchorDate: params.anchorDate,
        anchorDay: params.anchorDay,
        seed: params.seed
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data) => {
      setMessage(`Expected shifts rebuilt. Created ${data.created}, updated ${data.updated}.`);
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to build expected shifts.');
    }
  });

  const settingsMap = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      map.set(row.employee_s_number as string, (row.off_periods as number[]) ?? [4, 8]);
    }
    return map;
  }, [settingsQuery.data]);

  const schedule = scheduleQuery.data;

  const monthTitle = useMemo(() => {
    if (!schedule) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(schedule.meta.year, schedule.meta.month - 1, 1)));
  }, [schedule]);

  const calendarWeeks = useMemo(() => {
    if (!schedule) return [];
    return buildMonthWeeks(schedule.meta.year, schedule.meta.month);
  }, [schedule]);

  const rosterNameBySNumber = useMemo(() => {
    const map = new Map<string, string>();
    if (!schedule) return map;
    for (const employee of schedule.roster) {
      map.set(employee.s_number, employee.name);
    }
    return map;
  }, [schedule]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, ScheduleAssignment[]>();
    if (!schedule) return map;
    for (const assignment of schedule.schedule) {
      const key = `${assignment.date}|${assignment.period}`;
      const bucket = map.get(key) ?? [];
      bucket.push(assignment);
      map.set(key, bucket);
    }
    return map;
  }, [schedule]);

  const onSubmit = (values: ScheduleFormValues) => {
    setParams(values);
    setMessage(null);
  };

  return (
    <section className="space-y-4">
      <form className="grid gap-3 border border-neutral-300 bg-neutral-50 p-3 md:grid-cols-6" onSubmit={form.handleSubmit(onSubmit)}>
        <label className="text-sm">
          Year
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            type="number"
            {...form.register('year', { valueAsNumber: true })}
          />
        </label>
        <label className="text-sm">
          Month
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            type="number"
            {...form.register('month', { valueAsNumber: true })}
          />
        </label>
        <label className="text-sm">
          Anchor Date
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" type="date" {...form.register('anchorDate')} />
        </label>
        <label className="text-sm">
          Anchor Day
          <select className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('anchorDay')}>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <label className="text-sm">
          Seed
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            type="number"
            {...form.register('seed', { valueAsNumber: true })}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white" type="submit">
            Load
          </button>
          <button
            className="min-h-[44px] border border-neutral-500 px-3"
            onClick={() => manualRefresh.mutate()}
            type="button"
          >
            Refresh
          </button>
          <button
            className="min-h-[44px] border border-neutral-500 px-3"
            onClick={() => buildExpectedMutation.mutate()}
            type="button"
          >
            Build Expected
          </button>
        </div>
      </form>

      {message && <p className="text-sm text-brand-maroon">{message}</p>}
      {scheduleQuery.isLoading && <p className="text-sm text-neutral-600">Loading schedule...</p>}
      {scheduleQuery.error && <p className="text-sm text-red-700">{(scheduleQuery.error as Error).message}</p>}

      {schedule && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Generated at</p>
              <p className="text-sm font-medium">{new Date(schedule.meta.generatedAt).toLocaleString()}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Assignments</p>
              <p className="text-sm font-medium">{schedule.schedule.length}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Roster</p>
              <p className="text-sm font-medium">{schedule.roster.length}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Calendar days</p>
              <p className="text-sm font-medium">{Object.keys(schedule.calendar).length}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="border border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">
              Calendar View — {monthTitle}
            </h3>
            {calendarWeeks.map((week, weekIndex) => (
              <div className="overflow-x-auto border border-neutral-300" key={`week-${weekIndex}`}>
                <table className="min-w-[1150px] w-full text-xs md:text-sm">
                  <thead className="bg-neutral-100">
                    <tr>
                      <th className="border-b border-r border-neutral-300 p-2 text-left">Week {weekIndex + 1}</th>
                      {WEEKDAY_LABELS.map((label) => (
                        <th className="border-b border-neutral-300 p-2 text-left" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="border-b border-r border-neutral-300 p-2 text-left">Date</th>
                      {week.map((day) => {
                        const dayType = schedule.calendar[day.dateKey];
                        const dateCellClass = day.inCurrentMonth
                          ? 'bg-white text-neutral-900'
                          : 'bg-neutral-100 text-neutral-400';
                        return (
                          <th className={`border-b border-neutral-300 p-2 text-left ${dateCellClass}`} key={`${day.dateKey}-date`}>
                            <div className="flex items-center justify-between gap-2">
                              <span>{day.dayNumber}</span>
                              {dayType && (
                                <span className="border border-neutral-400 px-1 text-[10px] uppercase tracking-wide">
                                  {dayType}
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIOD_BANDS.map((periodBand) => (
                      <tr key={`${weekIndex}-${periodBand.id}`}>
                        <th className="border-b border-r border-neutral-300 bg-blue-50 p-2 text-left font-medium text-neutral-800">
                          {periodBand.label}
                        </th>
                        {week.map((day) => {
                          const dayType = schedule.calendar[day.dateKey];
                          const baseCellTone = !day.inCurrentMonth
                            ? 'bg-neutral-100'
                            : dayType === 'A'
                              ? 'bg-amber-50'
                              : dayType === 'B'
                                ? 'bg-violet-50'
                                : 'bg-white';

                          const assignments = periodBand.periods
                            .flatMap((period) => assignmentMap.get(`${day.dateKey}|${period}`) ?? [])
                            .sort((left, right) => {
                              if (left.period !== right.period) return left.period - right.period;
                              return left.shiftSlotKey.localeCompare(right.shiftSlotKey);
                            });

                          return (
                            <td className={`border-b border-neutral-300 p-2 align-top ${baseCellTone}`} key={`${day.dateKey}-${periodBand.id}`}>
                              {!day.inCurrentMonth && <span className="text-[11px] text-neutral-400">—</span>}
                              {day.inCurrentMonth && assignments.length === 0 && (
                                <span className="text-[11px] text-neutral-500">No assignment</span>
                              )}
                              {day.inCurrentMonth && assignments.length > 0 && (
                                <div className="space-y-1">
                                  {assignments.map((assignment) => {
                                    const offPeriods = settingsMap.get(assignment.effectiveWorkerSNumber) ?? [4, 8];
                                    const isOffPeriod = offPeriods.includes(assignment.period);
                                    const exchanged = assignment.studentSNumber !== assignment.effectiveWorkerSNumber;
                                    const effectiveName =
                                      rosterNameBySNumber.get(assignment.effectiveWorkerSNumber) ??
                                      assignment.effectiveWorkerSNumber;

                                    return (
                                      <div className="border border-neutral-300 bg-white/90 p-1" key={`${assignment.shiftSlotKey}-${assignment.studentSNumber}`}>
                                        <p className="font-medium leading-tight">
                                          {periodBand.periods.length > 1 && (
                                            <span className="mr-1 text-[10px] text-neutral-500">P{assignment.period}</span>
                                          )}
                                          {effectiveName}
                                        </p>
                                        {(exchanged || isOffPeriod) && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {exchanged && (
                                              <span className="border border-brand-maroon px-1 text-[10px] text-brand-maroon">
                                                Exchanged
                                              </span>
                                            )}
                                            {isOffPeriod && (
                                              <span className="border border-neutral-500 px-1 text-[10px] text-neutral-700">
                                                Off-period
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Statistics</h3>
              <div className="max-h-60 overflow-auto p-2 text-sm">
                {schedule.statistics.map((stat) => (
                  <p key={stat.metric}>
                    {stat.metric}: {stat.value}
                  </p>
                ))}
              </div>
            </div>
            <div className="border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Balance Analysis</h3>
              <div className="max-h-60 overflow-auto p-2 text-sm">
                {schedule.balanceAnalysis.map((item) => (
                  <p key={`${item.category}-${item.metric}`}>
                    {item.category} — {item.metric}: {item.value}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="overflow-x-auto border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Roster</h3>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Name</th>
                    <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Scheduleable</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.roster.slice(0, 120).map((entry) => (
                    <tr className="border-b border-neutral-200" key={entry.s_number}>
                      <td className="p-2">{entry.name}</td>
                      <td className="p-2">{entry.s_number}</td>
                      <td className="p-2">{entry.scheduleable ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Summary</h3>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Student</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Total</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Periods</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.summary.slice(0, 120).map((entry) => (
                    <tr className="border-b border-neutral-200" key={`${entry.studentSNumber}-${entry.group}`}>
                      <td className="p-2">{entry.student}</td>
                      <td className="p-2">{entry.totalShifts}</td>
                      <td className="p-2">{entry.periodsWorked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
