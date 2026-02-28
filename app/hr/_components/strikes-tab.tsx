'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { addStrike, removeStrike } from '@/app/actions/strikes';
import { usePermission } from '@/lib/permissions';

import { getStudentDisplayName, getStudentId, getStudentSNumber, StudentRow, useBrowserSupabase } from './utils';

const StrikeFormSchema = z.object({
  employee_id: z.string().trim().regex(/^\d+$/),
  reason: z.string().trim().min(1).max(500)
});

type StrikeFormValues = z.infer<typeof StrikeFormSchema>;

export function StrikesTab() {
  const canManage = usePermission('hr.strikes.manage');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();

  const studentsQuery = useQuery({
    queryKey: ['hr-strikes-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const strikesQuery = useQuery({
    queryKey: ['hr-strikes-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('strikes')
        .select('*')
        .order('issued_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const form = useForm<StrikeFormValues>({
    resolver: zodResolver(StrikeFormSchema),
    defaultValues: {
      employee_id: '',
      reason: ''
    }
  });

  const addMutation = useMutation({
    mutationFn: async (values: StrikeFormValues) => {
      const result = await addStrike(values.employee_id, values.reason);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-strikes-list'] });
      form.reset({ employee_id: form.getValues('employee_id'), reason: '' });
    }
  });

  const removeMutation = useMutation({
    mutationFn: async (strikeId: string) => {
      const result = await removeStrike(strikeId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr-strikes-list'] })
  });

  if (!canManage) {
    return <p className="text-sm text-neutral-700">You do not have permission to manage strikes.</p>;
  }

  return (
    <section className="space-y-4">
      <form
        className="space-y-3 border border-neutral-300 p-3"
        onSubmit={form.handleSubmit((values) => addMutation.mutate(values))}
      >
        <label className="block text-sm">
          Employee
          <select className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('employee_id')}>
            <option value="">Select employee</option>
            {(studentsQuery.data ?? []).map((student) => (
              <option key={getStudentId(student)} value={getStudentId(student)}>
                {`${getStudentDisplayName(student)} (${getStudentSNumber(student) || 'N/A'})`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Reason
          <textarea className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2" {...form.register('reason')} />
        </label>
        <button className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white" type="submit">
          Add Strike
        </button>
      </form>

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">Reason</th>
              <th className="border-b border-neutral-300 p-2 text-left">Issued At</th>
              <th className="border-b border-neutral-300 p-2 text-left">Issued By</th>
              <th className="border-b border-neutral-300 p-2 text-left">Status</th>
              <th className="border-b border-neutral-300 p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {(strikesQuery.data ?? []).map((strike) => {
              const employee = (studentsQuery.data ?? []).find(
                (student) => getStudentId(student) === String(strike.employee_id)
              );
              return (
                <tr className="border-b border-neutral-200" key={strike.id}>
                  <td className="p-2">{employee ? getStudentDisplayName(employee) : strike.employee_id}</td>
                  <td className="p-2">{strike.reason}</td>
                  <td className="p-2">{new Date(strike.issued_at).toLocaleDateString()}</td>
                  <td className="p-2">{strike.issued_by ?? 'open_access'}</td>
                  <td className="p-2">{strike.active ? 'Active' : 'Inactive'}</td>
                  <td className="p-2">
                    {strike.active && (
                      <button
                        className="min-h-[44px] border border-neutral-500 px-2"
                        onClick={() => removeMutation.mutate(strike.id as string)}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
