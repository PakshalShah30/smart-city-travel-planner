import Link from 'next/link';

import { createPlan, formatClock, formatDuration, isPlanError } from '@/lib/plan';
import type { Rejection } from '@/lib/solver/types';

export const metadata = { title: 'Your day plan' };

const REJECTION_COPY: Record<Rejection['reason'], string> = {
  closed: 'Closed on the day you picked',
  'too-long': 'Needs more time than the whole day allows',
  'day-full': 'Fits on its own, but not alongside the stops above',
};

/**
 * Typed explicitly rather than with Next's generated `PageProps<'/plan'>`, so a
 * fresh clone typechecks before `next typegen` has ever run.
 */
type PlanPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const params = await searchParams;
  const result = createPlan(params);

  if (isPlanError(result)) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-24">
        <h1 className="font-display text-3xl font-semibold">That didn&rsquo;t work</h1>
        <p className="mt-3 text-muted">{result.error}</p>
        <Link href="/" className="mt-6 inline-block font-semibold text-accent underline">
          Back to the planner
        </Link>
      </main>
    );
  }

  const { city, startPoint, startAt, solution, params: plan } = result;
  const budgetS = plan.hours * 3600;

  const summary = [
    { label: 'Budget', value: formatDuration(budgetS) },
    { label: 'Planned', value: formatDuration(solution.totalElapsedS) },
    { label: 'Stops', value: String(solution.stops.length) },
    { label: 'Back by', value: formatClock(solution.endAt) },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-muted hover:text-foreground">
        ← Change the plan
      </Link>

      <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">
        {city.name}, {formatDuration(budgetS)} from {startPoint.label}
      </h1>
      <p className="mt-2 text-muted">
        {plan.date} · starting {formatClock(startAt)}
        {plan.interests.length > 0 && <> · {plan.interests.join(', ')}</>}
      </p>

      <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-y border-border py-4">
        {summary.map((m) => (
          <div key={m.label} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-subtle">
              {m.label}
            </span>
            <span className="font-display text-xl font-semibold">{m.value}</span>
          </div>
        ))}
        {solution.stops.length > 0 && (
          <div className="flex items-center rounded-lg bg-teal-soft px-3 py-2 text-sm font-semibold text-teal">
            {formatDuration(solution.slackS)} to spare
          </div>
        )}
      </div>

      {solution.stops.length === 0 ? (
        <p className="mt-10 rounded-xl border border-border bg-surface p-5 text-muted">
          Nothing fits in {formatDuration(budgetS)} from here — everything nearby is either
          shut at that hour or needs longer than you have. Try a longer day or a later start.
        </p>
      ) : (
        <ol className="mt-8">
          <li className="flex items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-subtle text-xs font-semibold text-muted">
              ↑
            </span>
            <span className="flex-1 font-semibold">{startPoint.label}</span>
            <span className="text-sm text-muted">{formatClock(startAt)}</span>
          </li>

          {solution.stops.map((stop) => (
            <li key={stop.candidate.id}>
              <div className="flex items-center gap-3 py-1 pl-[15px] text-xs text-subtle">
                <span className="h-6 w-0.5 rounded bg-border" />
                {formatDuration(stop.travelFromPrevS)} travel
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
                  {stop.seq + 1}
                </span>
                <div className="flex-1">
                  <p className="font-semibold leading-tight">{stop.candidate.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {stop.candidate.categories.join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">
                    {formatClock(stop.arriveAt)}–{formatClock(stop.departAt)}
                  </p>
                  <p className="text-xs text-subtle">{stop.candidate.visitDurationMin}m</p>
                </div>
              </div>
            </li>
          ))}

          <li>
            <div className="flex items-center gap-3 py-1 pl-[15px] text-xs text-subtle">
              <span className="h-6 w-0.5 rounded bg-border" />
              {formatDuration(solution.returnTravelS)} back
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-teal text-xs font-semibold text-teal">
                ✓
              </span>
              <span className="flex-1 font-semibold">Back at {startPoint.label}</span>
              <span className="text-sm font-semibold text-teal">
                {formatClock(solution.endAt)}
              </span>
            </div>
          </li>
        </ol>
      )}

      {solution.rejected.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold">What was left out</h2>
          <p className="mt-1 text-sm text-muted">
            The strongest candidates that didn&rsquo;t make it, and why.
          </p>
          <ul className="mt-4">
            {solution.rejected.map((r) => (
              <li
                key={r.candidate.id}
                className="flex items-baseline justify-between gap-4 border-t border-border py-2.5"
              >
                <span className="text-sm font-medium">{r.candidate.name}</span>
                <span className="shrink-0 text-xs text-muted">{REJECTION_COPY[r.reason]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12 text-xs leading-relaxed text-subtle">
        Solved in {solution.solveMs}ms with the {solution.solver} algorithm. Travel times are
        straight-line estimates, not routed — Phase 2 replaces them with real street-network
        times, and Phase 3 replaces this solver with one that can beat it.
      </p>
    </main>
  );
}
