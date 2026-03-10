'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

export default function HomePage() {
  const [theme, setTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    const saved = window.localStorage.getItem('landing-theme');
    const next: ThemeMode = saved === 'dark' ? 'dark' : 'light';
    setTheme(next);
    document.body.style.backgroundColor = next === 'dark' ? '#0f172a' : '#f7f7f7';
  }, []);

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    window.localStorage.setItem('landing-theme', next);
    document.body.style.backgroundColor = next === 'dark' ? '#0f172a' : '#f7f7f7';
  };

  const pageClass = theme === 'dark' ? 'min-h-screen w-full bg-slate-950 p-6 text-slate-100' : 'min-h-screen w-full p-6';
  const panelClass = theme === 'dark'
    ? 'w-full border border-slate-700 bg-slate-900 p-8 text-center'
    : 'w-full border border-neutral-300 bg-white p-8 text-center';
  const subtitleClass = theme === 'dark' ? 'mt-3 text-sm text-slate-300' : 'mt-3 text-sm text-neutral-700';
  const toggleClass = theme === 'dark'
    ? 'fixed bottom-5 right-5 z-50 min-h-[44px] min-w-[44px] rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 shadow-md hover:bg-slate-700'
    : 'fixed bottom-5 right-5 z-50 min-h-[44px] min-w-[44px] rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-md hover:bg-neutral-100';

  return (
    <main className={pageClass}>
      <div className={panelClass}>
        <h1 className="text-2xl font-semibold">CO-OP Operations &amp; Intelligence Dashboard</h1>
        <p className={subtitleClass}>
          Choose which module to open first.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/product"
          >
            Open Product
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/hr?module=hr&tab=schedule"
          >
            Open HR
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/employee"
          >
            Open Employee
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/hr?module=cfa&tab=daily-log"
          >
            Open Chick-fil-A
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/inventory"
          >
            Open Inventory
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/marketing"
          >
            Open Marketing
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/finance"
          >
            Open Finance
          </Link>
        </div>
      </div>

      <button
        aria-label="Toggle dark mode"
        className={toggleClass}
        onClick={toggleTheme}
        type="button"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </main>
  );
}
