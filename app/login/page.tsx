'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

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
    <main className="min-h-screen w-full bg-neutral-100 p-4 text-neutral-900 md:p-8">
      <section className="mx-auto w-full max-w-md border border-neutral-300 bg-white p-5">
        <h1 className="text-xl font-semibold">Employee Sign In</h1>
        <p className="mt-1 text-sm text-neutral-700">
          Enter your employee ID (`s_number`) and password.
        </p>

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            Employee ID
            <input
              className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
              onChange={(event) => setEmployeeId(event.target.value)}
              value={employeeId}
            />
          </label>

          <label className="block text-sm">
            Password
            <input
              className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          <button
            className="min-h-[44px] w-full border border-brand-maroon bg-brand-maroon px-3 font-medium text-white disabled:opacity-50"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {status ? <p className="mt-3 text-sm text-red-700">{status}</p> : null}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen w-full bg-neutral-100 p-4 md:p-8" />}>
      <LoginPageInner />
    </Suspense>
  );
}
