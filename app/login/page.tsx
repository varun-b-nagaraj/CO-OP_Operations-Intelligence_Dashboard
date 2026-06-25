'use client';

import { AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

import { ThemeToggle } from '@/app/_components/ui/theme';
import { resetCurrentUserCache } from '@/lib/permissions';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/';

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId.trim(), password })
      });

      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setStatus(payload.error ?? 'Login failed.');
        return;
      }

      resetCurrentUserCache();
      router.replace(nextPath);
      router.refresh();
    } catch {
      setStatus('Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative grid min-h-screen w-full lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — always deep maroon regardless of theme (branded surface) */}
      <aside
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{ backgroundColor: '#800000' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[rgba(255,255,255,0.1)] blur-3xl float-blob"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-[rgba(0,0,0,0.2)] blur-3xl"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(255,255,255,0.15)] backdrop-blur">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="font-display text-base font-semibold tracking-tight">RRHS Co-Op</span>
        </div>
        <div className="reveal relative max-w-md">
          <h2 className="font-display text-4xl font-bold leading-[1.1] tracking-tight">
            Operations &amp; Intelligence, in one place.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[rgba(255,255,255,0.82)]">
            Scheduling, attendance, inventory, finance, and AI-assisted executive
            analytics — secured behind role-based access.
          </p>
          <div className="mt-8 flex items-center gap-6 text-sm text-[rgba(255,255,255,0.72)]">
            <div>
              <p className="font-display text-2xl font-bold text-white">8</p>
              <p className="mt-0.5 text-xs uppercase tracking-wide">Modules</p>
            </div>
            <div className="h-8 w-px bg-[rgba(255,255,255,0.2)]" />
            <div>
              <p className="font-display text-2xl font-bold text-white">RBAC</p>
              <p className="mt-0.5 text-xs uppercase tracking-wide">Role-aware</p>
            </div>
            <div className="h-8 w-px bg-[rgba(255,255,255,0.2)]" />
            <div>
              <p className="font-display text-2xl font-bold text-white">AI</p>
              <p className="mt-0.5 text-xs uppercase tracking-wide">Assisted</p>
            </div>
          </div>
        </div>
        <p className="relative text-xs text-[rgba(255,255,255,0.55)]">
          © RRHS Co-Op · Operations &amp; Intelligence Dashboard
        </p>
      </aside>

      {/* Form panel */}
      <section className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="reveal w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-maroon text-white shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-semibold tracking-tight">RRHS Co-Op</span>
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Sign in with your employee ID and password.
          </p>

          <form className="mt-7 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="employeeId" className="block text-sm font-medium text-ink">
                Employee ID
              </label>
              <input
                id="employeeId"
                autoComplete="username"
                placeholder="s_number"
                className="mt-1.5 min-h-[46px] w-full rounded-md border border-line bg-surface px-3 text-sm text-ink shadow-xs outline-none transition-all duration-200 placeholder:text-ink-muted focus:border-brand-maroon focus:shadow-ring"
                onChange={(event) => setEmployeeId(event.target.value)}
                value={employeeId}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1.5 min-h-[46px] w-full rounded-md border border-line bg-surface px-3 text-sm text-ink shadow-xs outline-none transition-all duration-200 placeholder:text-ink-muted focus:border-brand-maroon focus:shadow-ring"
                onChange={(event) => setPassword(event.target.value)}
                value={password}
              />
            </div>

            {status ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-viz-rose/30 bg-viz-rose/10 px-3 py-2.5 text-sm text-viz-rose"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{status}</span>
              </div>
            ) : null}

            <button
              className="group inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-brand-maroon px-4 font-medium text-white shadow-sm transition-all duration-200 hover:bg-brand-600 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen w-full" />}>
      <LoginPageInner />
    </Suspense>
  );
}
