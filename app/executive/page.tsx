import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { ExecutiveDashboard } from '@/app/executive/_components/executive-dashboard';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function ExecutivePage() {
  const canViewExecutive =
    (await ensureServerPermission('executive.overview:view:all')) ||
    (await ensureServerPermission('executive.ai:view:own')) ||
    (await ensureServerPermission('executive.hours:view:all'));
  if (!canViewExecutive) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading executive dashboard...</main>}>
      <ExecutiveDashboard />
    </Suspense>
  );
}
