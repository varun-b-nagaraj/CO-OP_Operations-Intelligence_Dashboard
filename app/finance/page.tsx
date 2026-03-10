import { Suspense } from 'react';

import { FinanceDashboard } from '@/app/finance/_components/finance-dashboard';

export default function FinancePage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading finance dashboard...</main>}>
      <FinanceDashboard />
    </Suspense>
  );
}
