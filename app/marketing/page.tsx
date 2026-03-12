import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { MarketingDashboard } from '@/app/marketing/_components/marketing-dashboard';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function MarketingPage() {
  const allowed =
    (await ensureServerPermission('marketing.events:view:own')) ||
    (await ensureServerPermission('marketing.reports:view:all'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading marketing dashboard...</main>}>
      <MarketingDashboard />
    </Suspense>
  );
}
