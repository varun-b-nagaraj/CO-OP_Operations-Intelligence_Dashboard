import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { HRModule } from '@/app/hr/_components/hr-module';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function CFAPage() {
  const allowed = await ensureServerPermission('cfa.logs:view:all');
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading Chick-fil-A module...</main>}>
      <HRModule forcedModule="cfa" />
    </Suspense>
  );
}
