import { Suspense } from 'react';

import { ExecutiveDashboard } from '@/app/executive/_components/executive-dashboard';

export default function ExecutivePage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading executive dashboard...</main>}>
      <ExecutiveDashboard />
    </Suspense>
  );
}
