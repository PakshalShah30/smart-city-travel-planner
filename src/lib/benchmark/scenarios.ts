/**
 * Deterministic benchmark scenarios.
 *
 * Seeded so the same run produces the same scenarios every time. A benchmark
 * whose inputs move between runs cannot tell you whether a change helped.
 */
import { estimateTravelSeconds } from '../geo';
import { getCandidates, getStartPoints } from '../pois';
import type { SolveRequest } from '../solver/types';

/** Small, fast, adequate for picking scenarios. Not for anything security-related. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INTEREST_POOL = [
  'history',
  'art',
  'food',
  'parks',
  'views',
  'markets',
  'religious',
  'family',
];

/** A week that includes the days some places are shut. */
const DATES = [
  '2026-10-05', // Monday
  '2026-10-06',
  '2026-10-07', // Wednesday
  '2026-10-08',
  '2026-10-09', // Friday
  '2026-10-10',
  '2026-10-11', // Sunday
];

const BUDGETS_MIN = [120, 180, 240, 300, 360, 480, 600];

export type Scenario = {
  id: string;
  city: string;
  label: string;
  request: SolveRequest;
};

export function generateScenarios(count = 50, seed = 20260918): Scenario[] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  const city = 'mumbai';
  const starts = getStartPoints(city);
  const candidates = getCandidates(city);

  return Array.from({ length: count }, (_, i) => {
    const start = pick(starts);
    const date = pick(DATES);
    const budgetMin = pick(BUDGETS_MIN);
    const hour = 8 + Math.floor(rand() * 8);
    const at = `${String(hour).padStart(2, '0')}:00`;

    const interestCount = Math.floor(rand() * 4);
    const interests: string[] = [];
    while (interests.length < interestCount) {
      const c = pick(INTEREST_POOL);
      if (!interests.includes(c)) interests.push(c);
    }

    return {
      id: `s${String(i + 1).padStart(2, '0')}`,
      city,
      label: `${start.label} · ${date} ${at} · ${budgetMin / 60}h${
        interests.length ? ` · ${interests.join('/')}` : ''
      }`,
      request: {
        start: start.location,
        startAt: new Date(`${date}T${at}:00.000Z`),
        budgetMin,
        interests,
        candidates,
        travelSeconds: estimateTravelSeconds,
      },
    };
  });
}
