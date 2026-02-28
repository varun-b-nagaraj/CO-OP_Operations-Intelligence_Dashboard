import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen w-full p-6">
      <div className="w-full border border-neutral-300 bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold">CO-OP Operations &amp; Intelligence Portal</h1>
        <p className="mt-3 text-sm text-neutral-700">
          Operations dashboard is available as a single-page route with HR and Chick-fil-A tabs.
        </p>
        <Link
          className="mt-6 inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-brand-maroon bg-brand-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[#6a0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-maroon"
          href="/hr"
        >
          Open Operations Dashboard
        </Link>
      </div>
    </main>
  );
}
