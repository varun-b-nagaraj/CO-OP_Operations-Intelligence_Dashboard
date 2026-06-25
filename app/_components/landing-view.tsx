'use client';

import {
  Activity,
  ArrowRight,
  Boxes,
  CalendarClock,
  ChartLine,
  CircleDollarSign,
  Megaphone,
  Package,
  ShieldCheck,
  Sparkles,
  UserRound,
  UtensilsCrossed
} from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

import { LogoutButton } from '@/app/_components/logout-button';
import { Badge, Reveal } from '@/app/_components/ui/kit';
import { ThemeToggle } from '@/app/_components/ui/theme';

export interface LandingDepartment {
  href: string;
  name: string;
  summary: string;
}

const META: Record<
  string,
  { icon: ReactNode; accent: string; tag: string }
> = {
  '/executive': { icon: <ChartLine className="h-5 w-5" />, accent: 'var(--brand)', tag: 'Intelligence' },
  '/hr': { icon: <CalendarClock className="h-5 w-5" />, accent: 'var(--accent-blue)', tag: 'People' },
  '/product': { icon: <Package className="h-5 w-5" />, accent: 'var(--accent-teal)', tag: 'Catalog' },
  '/marketing': { icon: <Megaphone className="h-5 w-5" />, accent: 'var(--accent-amber)', tag: 'Growth' },
  '/finance': { icon: <CircleDollarSign className="h-5 w-5" />, accent: 'var(--accent-green)', tag: 'Money' },
  '/inventory': { icon: <Boxes className="h-5 w-5" />, accent: 'var(--accent-blue)', tag: 'Stock' },
  '/employee': { icon: <UserRound className="h-5 w-5" />, accent: 'var(--accent-teal)', tag: 'Self-serve' },
  '/cfa': { icon: <UtensilsCrossed className="h-5 w-5" />, accent: 'var(--accent-rose)', tag: 'Operations' }
};

function deptMeta(href: string) {
  return META[href] ?? { icon: <Activity className="h-5 w-5" />, accent: 'var(--brand)', tag: 'Module' };
}

export function LandingView({
  departments,
  authed,
  showEmptyState
}: {
  departments: LandingDepartment[];
  authed: boolean;
  showEmptyState: boolean;
}) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden px-4 py-6 md:px-8">
      {/* Ambient brand glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10%] h-[460px] w-[460px] rounded-full blur-3xl float-blob"
        style={{ background: 'radial-gradient(circle, var(--brand-glow), transparent 70%)' }}
      />

      <div className="relative mx-auto w-full max-w-6xl">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-maroon text-white shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="font-display text-sm font-semibold tracking-tight">
              RRHS&nbsp;Co-Op
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {authed ? (
              <LogoutButton className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-xs transition-colors duration-200 hover:border-brand-maroon hover:text-brand-maroon" />
            ) : null}
          </div>
        </header>

        {/* Hero */}
        <section className="reveal py-10 md:py-14">
          <Badge tone="brand" className="reveal reveal-d1">
            <Sparkles className="h-3.5 w-3.5" />
            Operations &amp; Intelligence Platform
          </Badge>
          <h1 className="reveal reveal-d2 mt-4 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            <span className="text-gradient-brand">Run the co-op</span>
            <br />
            from a single command center.
          </h1>
          <p className="reveal reveal-d3 mt-5 max-w-xl text-base leading-relaxed text-ink-soft md:text-lg">
            Scheduling, attendance, inventory, finance, and AI-assisted executive
            analytics — unified into one fast, role-aware workspace.
          </p>

          {authed ? (
            <p className="reveal reveal-d4 mt-6 text-sm text-ink-muted">
              Select a module below to continue. Access is scoped to your role.
            </p>
          ) : (
            <div className="reveal reveal-d4 mt-7">
              <Link
                href="/login"
                className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-md bg-brand-maroon px-6 text-base font-medium text-white shadow-sm transition-all duration-200 hover:bg-brand-600 hover:shadow-md active:scale-[0.98]"
              >
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </section>

        {/* Module grid */}
        {departments.length > 0 ? (
          <section
            aria-label="Department modules"
            className="grid gap-3.5 pb-12 sm:grid-cols-2 xl:grid-cols-3"
          >
            {departments.map((dept, i) => {
              const meta = deptMeta(dept.href);
              return (
                <Reveal key={dept.href} delay={i * 60}>
                  <Link
                    href={dept.href}
                    className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-maroon hover:shadow-lg"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                      style={{ background: meta.accent }}
                    />
                    <div className="flex items-center justify-between">
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-300 group-hover:scale-110"
                        style={{ background: meta.accent }}
                      >
                        {meta.icon}
                      </span>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                        {meta.tag}
                      </span>
                    </div>
                    <h2 className="mt-4 font-display text-lg font-semibold text-ink">
                      {dept.name}
                    </h2>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-soft">
                      {dept.summary}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-maroon">
                      Open module
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </span>
                  </Link>
                </Reveal>
              );
            })}
          </section>
        ) : null}

        {authed && showEmptyState ? (
          <div className="mb-12 rounded-lg border border-line bg-surface p-6 text-sm text-ink-soft shadow-sm">
            No department access has been assigned to this account yet. Contact an
            administrator to request access.
          </div>
        ) : null}

        <footer className="border-t border-line py-6 text-xs text-ink-muted">
          RRHS Co-Op · Operations &amp; Intelligence Dashboard
        </footer>
      </div>
    </main>
  );
}
