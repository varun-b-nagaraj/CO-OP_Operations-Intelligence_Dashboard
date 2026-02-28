'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { updateEmployeeOffPeriods } from '@/app/actions/employee-settings';
import { usePermission } from '@/lib/permissions';

import { useBrowserSupabase } from './utils';

const SettingsFormSchema = z.object({
  employee_id: z.string().trim().regex(/^\d+$/),
  off_periods: z.array(z.number().int().min(1).max(8)).min(1)
});

type SettingsFormValues = z.infer<typeof SettingsFormSchema>;

type StudentRow = {
  id: string;
  name?: string;
  full_name?: string;
  s_number?: string;
};

export function SettingsTab() {
  const canEdit = usePermission('hr.settings.edit');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);

  const studentsQuery = useQuery({
    queryKey: ['hr-settings-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('id,name,full_name,s_number');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['hr-settings-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_settings').select('*');
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const firstEmployeeId = studentsQuery.data?.[0]?.id ?? '';
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(SettingsFormSchema),
    defaultValues: {
      employee_id: firstEmployeeId,
      off_periods: [4, 8]
    }
  });

  useEffect(() => {
    if (!firstEmployeeId || form.getValues('employee_id')) return;
    form.setValue('employee_id', firstEmployeeId);
  }, [firstEmployeeId, form]);

  const settingsByEmployee = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      map.set(row.employee_id as string, (row.off_periods as number[]) ?? [4, 8]);
    }
    return map;
  }, [settingsQuery.data]);

  const selectedEmployeeId = form.watch('employee_id');
  useEffect(() => {
    if (!selectedEmployeeId) return;
    const offPeriods = settingsByEmployee.get(selectedEmployeeId) ?? [4, 8];
    form.setValue('off_periods', offPeriods);
  }, [form, selectedEmployeeId, settingsByEmployee]);

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      const result = await updateEmployeeOffPeriods(values.employee_id, values.off_periods);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatus('Employee off-periods updated.');
      queryClient.invalidateQueries({ queryKey: ['hr-settings-all'] });
    },
    onError: (error) => {
      setStatus(error instanceof Error ? error.message : 'Unable to update settings.');
    }
  });

  const togglePeriod = (period: number) => {
    const values = form.getValues('off_periods');
    const next = values.includes(period)
      ? values.filter((item) => item !== period)
      : [...values, period].sort((left, right) => left - right);
    form.setValue('off_periods', next);
  };

  if (!canEdit) {
    return <p className="text-sm text-neutral-700">You do not have permission to edit settings.</p>;
  }

  return (
    <section className="space-y-4">
      <form
        className="space-y-3 border border-neutral-300 p-3"
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
      >
        <label className="block text-sm">
          Employee
          <select className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('employee_id')}>
            {(studentsQuery.data ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {(student.name ?? student.full_name ?? 'Unknown') + ` (${student.s_number ?? 'N/A'})`}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="mb-2 text-sm font-medium">Off periods</p>
          <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
            {Array.from({ length: 8 }, (_, index) => index + 1).map((period) => {
              const selected = form.watch('off_periods').includes(period);
              return (
                <button
                  className={`min-h-[44px] border px-2 text-sm ${
                    selected
                      ? 'border-brand-maroon bg-brand-maroon text-white'
                      : 'border-neutral-300 bg-white text-neutral-900'
                  }`}
                  key={period}
                  onClick={() => togglePeriod(period)}
                  type="button"
                >
                  P{period}
                </button>
              );
            })}
          </div>
        </div>

        <button
          className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white"
          disabled={saveMutation.isPending}
          type="submit"
        >
          Save Off-Periods
        </button>
      </form>

      {status && <p className="text-sm text-brand-maroon">{status}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
              <th className="border-b border-neutral-300 p-2 text-left">Off Periods</th>
            </tr>
          </thead>
          <tbody>
            {(studentsQuery.data ?? []).map((student) => {
              const offPeriods = settingsByEmployee.get(student.id) ?? [4, 8];
              return (
                <tr className="border-b border-neutral-200" key={student.id}>
                  <td className="p-2">{student.name ?? student.full_name ?? 'Unknown'}</td>
                  <td className="p-2">{student.s_number ?? 'N/A'}</td>
                  <td className="p-2">{offPeriods.join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
