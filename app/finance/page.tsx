import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { FinanceDashboard } from '@/app/finance/_components/finance-dashboard';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function FinancePage() {
  const allowed =
    (await ensureServerPermission('finance.reports:view:all')) ||
    (await ensureServerPermission('finance.upload:view:own'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading finance dashboard...</main>}>
      <FinanceDashboard />
    </Suspense>
  );
}
