import { Suspense } from 'react';

import { HRModule } from '@/app/hr/_components/hr-module';

export default function CFAPage() {
  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading Chick-fil-A module...</main>}>
      <HRModule forcedModule="cfa" />
    </Suspense>
  );
}
