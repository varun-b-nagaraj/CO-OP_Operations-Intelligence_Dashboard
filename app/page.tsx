import Link from 'next/link';

import { LogoutButton } from '@/app/_components/logout-button';
import { getServerAuthContext } from '@/lib/server/auth';

const DEPARTMENTS: Array<{ href: string; name: string; summary: string }> = [
  {
    href: '/executive',
    name: 'Executive',
    summary: 'Cross-department overview, AI agent, alerts, and executive metrics.'
  },
  {
    href: '/hr',
    name: 'HR',
    summary: 'Shift scheduling, attendance, requests, strikes, and employee operations.'
  },
  {
    href: '/product',
    name: 'Product',
    summary: 'Orders, vendors, catalog, designs, prompts, and wishlist workflow.'
  },
  {
    href: '/marketing',
    name: 'Marketing',
    summary: 'Events, campaigns, contacts, coordinators, and marketing reports.'
  },
  {
    href: '/finance',
    name: 'Finance',
    summary: 'Report uploads, issue tracking, approvals, and reconciliation workflow.'
  },
  {
    href: '/inventory',
    name: 'Inventory',
    summary: 'Session counts, catalog sync, finalization, and upload submission.'
  },
  {
    href: '/employee',
    name: 'Employee',
    summary: 'Personal schedule, accountability metrics, and self-service requests.'
  },
  {
    href: '/cfa',
    name: 'Chick-fil-A',
    summary: 'CFA operations, daily logs, A/B analysis, forecasting, and menu planning.'
  }
];

const DEPARTMENT_VIEW_PERMISSIONS: Record<string, string[]> = {
  '/executive': ['executive.overview.view', 'executive.ai_agent.view'],
  '/hr': ['hr.schedule.view', 'hr.attendance.view', 'hr.requests.view'],
  '/product': ['product.orders.view', 'product.products.view', 'product.vendors.view'],
  '/marketing': ['marketing.events.view', 'marketing.reports.view', 'marketing.contacts.view'],
  '/finance': ['finance.reports.view', 'finance.upload.view'],
  '/inventory': ['inventory.catalog.view', 'inventory.sessions.view', 'inventory.count_view.view'],
  '/employee': ['employee.schedule.view', 'employee.calendar.view', 'employee.accountability.view'],
  '/cfa': ['cfa.logs.read']
};

export default async function HomePage() {
  const auth = await getServerAuthContext();
  const visibleDepartments = !auth
    ? DEPARTMENTS
    : DEPARTMENTS.filter((department) =>
        (DEPARTMENT_VIEW_PERMISSIONS[department.href] ?? []).some((permission) =>
          auth.permissions.includes(permission)
        )
      );

  return (
    <main className="min-h-screen w-full bg-neutral-100 px-4 py-8 text-neutral-900 md:px-8">
      <section className="mx-auto w-full max-w-6xl">
        <header className="mb-5 border border-neutral-300 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">CO-OP Operations Dashboard</h1>
              <p className="mt-1 text-sm text-neutral-700">
                Select a department module to continue.
              </p>
            </div>
            {auth ? <LogoutButton /> : null}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleDepartments.map((department) => (
            <Link
              className="block border border-neutral-300 bg-white p-4 transition-colors hover:bg-neutral-50"
              href={department.href}
              key={department.href}
            >
              <h2 className="text-base font-semibold">{department.name}</h2>
              <p className="mt-2 text-sm text-neutral-700">{department.summary}</p>
            </Link>
          ))}
        </section>
        {auth && visibleDepartments.length === 0 ? (
          <p className="mt-4 border border-neutral-300 bg-white p-4 text-sm text-neutral-700">
            No department access has been assigned to this account yet.
          </p>
        ) : null}
      </section>
    </main>
  );
}
