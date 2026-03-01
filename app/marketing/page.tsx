import { Suspense } from 'react';

import { MarketingDashboard } from '@/app/marketing/_components/marketing-dashboard';

export default function MarketingPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading marketing dashboard...</main>}>
      <MarketingDashboard />
    </Suspense>
  );
}
