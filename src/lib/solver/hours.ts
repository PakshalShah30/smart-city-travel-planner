import type { Hours } from './types';

/**
 * Time convention for the whole solver: a Date represents LOCAL wall-clock in
 * the city, expressed with UTC getters. So 9am in Mumbai is
 * `new Date('2026-10-03T09:00:00Z')`, not the instant that is 9am IST.
 *
 * This keeps the solver free of timezone maths and makes tests deterministic
 * regardless of where they run. Converting a real instant into this frame is
 * the caller's job, using the city's IANA timezone.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Minutes from local midnight. */
export function minutesOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/** 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(at: Date): number {
  return at.getUTCDay();
}

/**
 * True when a visit starting at `arriveAt` and lasting `visitMin` finishes
 * before closing time.
 *
 * Unknown hours count as open. Bad source data should not silently delete a
 * landmark from every itinerary — Phase 2 flags these rows instead.
 */
export function isOpenDuring(hours: Hours, arriveAt: Date, visitMin: number): boolean {
  if (hours.kind === 'always' || hours.kind === 'unknown') return true;

  const day = dayOfWeek(arriveAt);
  const start = minutesOfDay(arriveAt);
  const end = start + visitMin;

  // A visit that would run past midnight is out of scope for a day plan.
  if (end > MINUTES_PER_DAY) return false;

  return hours.windows.some(
    (w) => w.day === day && start >= w.opensMin && end <= w.closesMin,
  );
}

/** True when the place opens at all on the day of `at`. Used to explain rejections. */
export function isOpenOnDay(hours: Hours, at: Date): boolean {
  if (hours.kind === 'always' || hours.kind === 'unknown') return true;
  return hours.windows.some((w) => w.day === dayOfWeek(at));
}

/** Convenience for seed data: the same window every day. */
export function dailyWindow(opensMin: number, closesMin: number): Hours {
  return {
    kind: 'windows',
    windows: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opensMin, closesMin })),
  };
}

/** Convenience for seed data: the same window, closed on the given days. */
export function dailyWindowExcept(
  opensMin: number,
  closesMin: number,
  closedDays: readonly number[],
): Hours {
  return {
    kind: 'windows',
    windows: [0, 1, 2, 3, 4, 5, 6]
      .filter((day) => !closedDays.includes(day))
      .map((day) => ({ day, opensMin, closesMin })),
  };
}
