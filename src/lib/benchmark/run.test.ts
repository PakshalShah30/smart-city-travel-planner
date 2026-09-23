import { describe, expect, it } from 'vitest';

import { estimateTravelSeconds } from '../geo';
import { getCandidates } from '../pois';
import { GREEDY, solveGreedy } from '../solver/greedy';
import { POPULARITY_FIRST, solvePopularityFirst } from '../solver/baselines';
import type { SolveRequest } from '../solver/types';
import { generateScenarios } from './scenarios';
import { runBenchmark, validate } from './run';
import { BENCHMARK_SOLVERS } from './solvers';

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

  it('catches a schedule whose arrival times do not follow from the travel function', () => {
    // The cheapest way to look good: quote travel legs you did not pay for.
    const good = solveGreedy(req);
    const rushed = {
      ...good.stops[0],
      travelFromPrevS: Math.max(0, good.stops[0].travelFromPrevS - 60),
    };
    expect(validate({ ...good, stops: [rushed, ...good.stops.slice(1)] }, req)).toContain(
      'bad-schedule',
    );
  });

  it('catches a solver that grades its own homework generously', () => {
    const good = solveGreedy(req);
    expect(validate({ ...good, totalScore: good.totalScore + 1 }, req)).toContain(
      'score-mismatch',
    );
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

  it('runs all three solvers cleanly and improves at every step', () => {
    const result = runBenchmark(generateScenarios(20), [...BENCHMARK_SOLVERS]);

    expect(result.summaries).toHaveLength(3);
    for (const s of result.summaries) expect(s.violations).toBe(0);

    const scores = result.summaries.map((s) => s.meanScore);
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[2]).toBeGreaterThan(scores[1]);
  });

  it('never lets local search lose a scenario to the greedy solver it starts from', () => {
    // If this ever fails, local search accepted a move it should have rejected.
    const result = runBenchmark(generateScenarios(20), [...BENCHMARK_SOLVERS]);
    const step = result.steps.at(-1)!;
    expect(step.against).toBe(GREEDY.label);
    expect(step.losses).toBe(0);
  });
});
