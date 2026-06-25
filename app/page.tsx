import { buildVisibleNav, canonicalizePermissions } from '@/lib/access/engine';
import { LandingView, type LandingDepartment } from '@/app/_components/landing-view';
import { getServerAuthContext } from '@/lib/server/auth';

const DEPARTMENTS: LandingDepartment[] = [
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

export default async function HomePage() {
  const auth = await getServerAuthContext();
  const departmentByHref = new Map(DEPARTMENTS.map((department) => [department.href, department]));
  const visibleHrefs = !auth
    ? []
    : buildVisibleNav(undefined, canonicalizePermissions(auth.permissions))
        .flatMap((section) => section.children.map((child) => child.href));
  const visibleDepartments = visibleHrefs
    .map((href) => departmentByHref.get(href))
    .filter((department): department is LandingDepartment => Boolean(department));

  return (
    <LandingView
      departments={visibleDepartments}
      authed={Boolean(auth)}
      showEmptyState={Boolean(auth) && visibleDepartments.length === 0}
    />
  );
}
