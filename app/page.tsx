import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen w-full p-6">
      <div className="w-full border border-neutral-300 bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold">CO-OP Operations &amp; Intelligence Dashboard</h1>
        <p className="mt-3 text-sm text-neutral-700">
          Choose which module to open first.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
            href="/hr?module=hr&tab=schedule"
          >
            Open HR
          </Link>
          <Link
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700"
            href="/hr?module=cfa&tab=daily-log"
          >
            Open Chick-fil-A
          </Link>
        </div>
      </div>
    </main>
  );
}
