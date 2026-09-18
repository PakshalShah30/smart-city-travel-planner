import Link from 'next/link';

import { CATEGORY_OPTIONS } from '@/lib/plan';
import { CITIES, getStartPoints } from '@/lib/pois';

export default function Home() {
  const city = CITIES[0];
  const startPoints = getStartPoints(city.slug);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-teal">
        Time-budgeted city itineraries
      </p>
      <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl">
        You have six hours.
        <br />
        Let&rsquo;s spend them well.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
        Tell us the city, where you&rsquo;re starting from and how long you&rsquo;ve got. We
        solve for the best route through real places and get you back where you started.
      </p>

      <form action="/plan" method="get" className="mt-10 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="city" className="text-xs font-semibold text-muted">
              City
            </label>
            <select id="city" name="city" defaultValue={city.slug} className="h-11 rounded-lg border border-border bg-surface px-3 text-[15px]">
              {CITIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="from" className="text-xs font-semibold text-muted">
              Starting point
            </label>
            <select id="from" name="from" defaultValue="colaba" className="h-11 rounded-lg border border-border bg-surface px-3 text-[15px]">
              {startPoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="date" className="text-xs font-semibold text-muted">
              Date
            </label>
            <input id="date" name="date" type="date" defaultValue={today} className="h-11 rounded-lg border border-border bg-surface px-3 text-[15px]" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="at" className="text-xs font-semibold text-muted">
                Start at
              </label>
              <input id="at" name="at" type="time" defaultValue="09:00" className="h-11 rounded-lg border border-border bg-surface px-3 text-[15px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hours" className="text-xs font-semibold text-muted">
                Hours
              </label>
              <select id="hours" name="hours" defaultValue="6" className="h-11 rounded-lg border border-border bg-surface px-3 text-[15px]">
                {[2, 3, 4, 5, 6, 8, 10].map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-xs font-semibold text-muted">What are you into?</legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((c) => (
              <label
                key={c.slug}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white"
              >
                <input
                  type="checkbox"
                  name="interests"
                  value={c.slug}
                  defaultChecked={c.slug === 'history' || c.slug === 'food'}
                  className="h-4 w-4 accent-accent"
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-semibold text-white hover:bg-accent-hover"
        >
          Build my day
        </button>
      </form>

      <p className="mt-6 text-sm text-subtle">
        Phase 1 of 6. The planner works end to end on hand-curated Mumbai data with estimated
        travel times.{' '}
        <Link href="https://github.com/PakshalShah30/smart-city-travel-planner" className="underline">
          Source and roadmap
        </Link>
        .
      </p>
    </main>
  );
}
