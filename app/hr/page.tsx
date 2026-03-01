import { Suspense } from 'react';

import { HRModule } from './_components/hr-module';

export default function HRPage() {
  return (
    <Suspense fallback={<main className="text-sm text-neutral-700">Loading HR module...</main>}>
      <HRModule />
    </Suspense>
  );
}
