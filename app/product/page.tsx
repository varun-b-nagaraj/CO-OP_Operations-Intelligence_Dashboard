import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { ProductDashboard } from './_components/product-dashboard';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function ProductPage() {
  const allowed =
    (await ensureServerPermission('product.products:view:all')) ||
    (await ensureServerPermission('product.orders:view:own'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading product dashboard...</main>}>
      <ProductDashboard />
    </Suspense>
  );
}
