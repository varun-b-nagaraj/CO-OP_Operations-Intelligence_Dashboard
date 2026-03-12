import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { EmployeeModule } from './_components/employee-module';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function EmployeePage() {
  const allowed =
    (await ensureServerPermission('employee.schedule:view:own')) ||
    (await ensureServerPermission('employee.calendar:view:own')) ||
    (await ensureServerPermission('employee.accountability:view:own')) ||
    (await ensureServerPermission('employee.requests:submit:own'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading employee dashboard...</main>}>
      <EmployeeModule />
    </Suspense>
  );
}
