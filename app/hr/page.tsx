import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { ensureServerPermission } from '@/lib/server/permissions';

import { HRModule } from './_components/hr-module';

export default async function HRPage() {
  const allowed =
    (await ensureServerPermission('hr.schedule:view:own')) ||
    (await ensureServerPermission('hr.requests:submit:own'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading HR module...</main>}>
      <HRModule forcedModule="hr" />
    </Suspense>
  );
}
