import { describe, expect, it } from 'vitest';

import { estimateTravelSeconds } from '../geo';
import { getCandidates } from '../pois';
import { GREEDY, solveGreedy } from '../solver/greedy';
import { POPULARITY_FIRST, solvePopularityFirst } from '../solver/baselines';
import type { SolveRequest } from '../solver/types';
import { generateScenarios } from './scenarios';
import { runBenchmark, validate } from './run';

const req: SolveRequest = {
  start: { lng: 72.828, lat: 18.9155 },
  startAt: new Date('2026-10-03T09:00:00.000Z'),
  budgetMin: 360,
  interests: [],
  candidates: getCandidates('mumbai'),
  travelSeconds: estimateTravelSeconds,
};

describe('validate', () => {
  it('passes a real solution from each solver', () => {
    expect(validate(solveGreedy(req), req)).toEqual([]);
    expect(validate(solvePopularityFirst(req), req)).toEqual([]);
  });

  it('catches a solver that overruns the budget', () => {
    const cheat = { ...solveGreedy(req), totalElapsedS: req.budgetMin * 60 + 1 };
    expect(validate(cheat, req)).toContain('over-budget');
  });

  it('catches a duplicated stop', () => {
    const good = solveGreedy(req);
    const cheat = { ...good, stops: [...good.stops, good.stops[0]] };
    expect(validate(cheat, req)).toContain('duplicate-stop');
  });

  it('catches an end time that forgets the journey home', () => {
    const good = solveGreedy(req);
    const cheat = { ...good, endAt: new Date(good.endAt.getTime() - 60_000) };
    expect(validate(cheat, req)).toContain('bad-return');
  });

  it('catches arriving somewhere shut', () => {
    const good = solveGreedy(req);
    const shut = {
      ...good.stops[0],
      candidate: {
        ...good.stops[0].candidate,
        hours: { kind: 'windows' as const, windows: [{ day: 0, opensMin: 0, closesMin: 1 }] },
      },
    };
    const cheat = { ...good, stops: [shut, ...good.stops.slice(1)] };
    expect(validate(cheat, req)).toContain('closed-on-arrival');
  });
});

describe('generateScenarios', () => {
  it('is reproducible for a given seed', () => {
    const a = generateScenarios(10, 42).map((s) => s.label);
    const b = generateScenarios(10, 42).map((s) => s.label);
    expect(a).toEqual(b);
  });

  it('varies with the seed', () => {
    const a = generateScenarios(10, 1).map((s) => s.label);
    const b = generateScenarios(10, 2).map((s) => s.label);
    expect(a).not.toEqual(b);
  });
});

describe('runBenchmark', () => {
  it('ranks the better solver above the naive one', () => {
    const result = runBenchmark(generateScenarios(20), [POPULARITY_FIRST, GREEDY]);
    const naive = result.summaries.find((s) => s.name === 'popularity-first')!;
    const greedy = result.summaries.find((s) => s.name === 'greedy')!;

    expect(greedy.meanScore).toBeGreaterThan(naive.meanScore);
    expect(result.headToHead.wins).toBeGreaterThan(result.headToHead.losses);
  });

  it('reports no invariant violations from either solver', () => {
    const result = runBenchmark(generateScenarios(20), [POPULARITY_FIRST, GREEDY]);
    for (const s of result.summaries) expect(s.violations).toBe(0);
  });
});
