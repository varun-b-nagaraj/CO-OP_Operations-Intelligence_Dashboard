'use client';

export function FinanceCalendarTab() {
  return (
    <section className="space-y-4 px-4 py-4 md:px-6">
      <article className="border border-neutral-300 bg-white p-4">
        <h3 className="text-base font-semibold text-neutral-900">General Calendar (Scaffold)</h3>
        <p className="mt-2 text-sm text-neutral-700">
          This tab is reserved for Finance calendar workflows (closing windows, payout checkpoints,
          monthly reconciliations, and audit deadlines).
        </p>
      </article>

      <article className="grid gap-3 md:grid-cols-3">
        <div className="border border-neutral-300 bg-neutral-50 p-3">
          <p className="text-xs uppercase text-neutral-600">Future Module</p>
          <p className="mt-1 text-sm font-medium text-neutral-900">Reconciliation Milestones</p>
        </div>
        <div className="border border-neutral-300 bg-neutral-50 p-3">
          <p className="text-xs uppercase text-neutral-600">Future Module</p>
          <p className="mt-1 text-sm font-medium text-neutral-900">Export Deadlines</p>
        </div>
        <div className="border border-neutral-300 bg-neutral-50 p-3">
          <p className="text-xs uppercase text-neutral-600">Future Module</p>
          <p className="mt-1 text-sm font-medium text-neutral-900">Finance Team Reminders</p>
        </div>
      </article>
    </section>
  );
}
