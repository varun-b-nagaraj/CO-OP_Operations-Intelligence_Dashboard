import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { InventoryDashboard } from '@/app/inventory/_components/inventory-dashboard';
import { ensureServerPermission } from '@/lib/server/permissions';

export default async function InventoryPage() {
  const allowed =
    (await ensureServerPermission('inventory.sessions:join:assigned_location')) ||
    (await ensureServerPermission('inventory.catalog:view:all'));
  if (!allowed) {
    redirect('/');
  }

  return (
    <Suspense fallback={<main className="p-4 text-sm text-neutral-700">Loading inventory dashboard...</main>}>
      <InventoryDashboard />
    </Suspense>
  );
}
