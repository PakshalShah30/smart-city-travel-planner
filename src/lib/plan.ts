/**
 * The application service between the URL and the solver.
 *
 * Plans are addressed entirely by query string, which means every plan already
 * has a shareable link and the results page can stay a server component with no
 * client state at all.
 */
import { z } from 'zod';

import { estimateTravelSeconds } from './geo';
import { getCandidates, getCity, getStartPoint, type City, type StartPoint } from './pois';
import { solveGreedy } from './solver/greedy';
import type { Solution } from './solver/types';

export const CATEGORY_OPTIONS = [
  { slug: 'history', label: 'History' },
  { slug: 'art', label: 'Art and museums' },
  { slug: 'food', label: 'Food' },
  { slug: 'parks', label: 'Parks' },
  { slug: 'views', label: 'Views' },
  { slug: 'markets', label: 'Markets' },
  { slug: 'religious', label: 'Temples and churches' },
  { slug: 'family', label: 'Family' },
] as const;

const CATEGORY_SLUGS = CATEGORY_OPTIONS.map((c) => c.slug);

/** Interests arrive as repeated params or one comma-joined value; accept both. */
const interestsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (!v) return [];
    const raw = Array.isArray(v) ? v : v.split(',');
    return raw.map((s) => s.trim()).filter((s) => CATEGORY_SLUGS.includes(s as never));
  });

export const planParamsSchema = z.object({
  city: z.string().min(1).default('mumbai'),
  from: z.string().min(1),
  /** Whole or half hours, 1 to 12. */
  hours: z.coerce.number().min(1).max(12),
  /** Local start time as HH:MM, 24-hour. */
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must look like 09:00')
    .default('09:00'),
  /** ISO date, the day being planned. Affects opening hours. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must look like 2026-10-03'),
  interests: interestsSchema,
});

export type PlanParams = z.infer<typeof planParamsSchema>;

export type Plan = {
  params: PlanParams;
  city: City;
  startPoint: StartPoint;
  startAt: Date;
  solution: Solution;
};

export type PlanError = { error: string };

/**
 * Build the Date the solver wants.
 *
 * The solver treats a Date as local wall-clock expressed in UTC, so the city's
 * offset deliberately does not come into it. See src/lib/solver/hours.ts.
 */
export function localStart(date: string, at: string): Date {
  return new Date(`${date}T${at}:00.000Z`);
}

export function createPlan(input: unknown): Plan | PlanError {
  const parsed = planParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Those options do not look right.' };
  }

  const params = parsed.data;
  const city = getCity(params.city);
  if (!city) return { error: `We do not cover ${params.city} yet.` };

  const startPoint = getStartPoint(city.slug, params.from);
  if (!startPoint) return { error: 'Pick a starting point from the list.' };

  const startAt = localStart(params.date, params.at);
  if (Number.isNaN(startAt.getTime())) return { error: 'That date is not a real date.' };

  const solution = solveGreedy({
    start: startPoint.location,
    startAt,
    budgetMin: Math.round(params.hours * 60),
    interests: params.interests,
    candidates: getCandidates(city.slug),
    travelSeconds: estimateTravelSeconds,
  });

  return { params, city, startPoint, startAt, solution };
}

export function isPlanError(result: Plan | PlanError): result is PlanError {
  return 'error' in result;
}

/** HH:MM in the city's local frame. Uses UTC getters by the solver's convention. */
export function formatClock(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}

/** "5h 25m", "45m", "2h". */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
