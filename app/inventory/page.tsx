import { Suspense } from 'react';

import { InventoryDashboard } from '@/app/inventory/_components/inventory-dashboard';

export default function InventoryPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading inventory dashboard...</main>}>
      <InventoryDashboard />
    </Suspense>
  );
}
