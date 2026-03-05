import { Suspense } from 'react';

import { EmployeeModule } from './_components/employee-module';

export default function EmployeePage() {
  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading employee dashboard...</main>}>
      <EmployeeModule />
    </Suspense>
  );
}
