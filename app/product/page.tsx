import { Suspense } from 'react';

import { ProductDashboard } from './_components/product-dashboard';

export default function ProductPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading product dashboard...</main>}>
      <ProductDashboard />
    </Suspense>
  );
}
