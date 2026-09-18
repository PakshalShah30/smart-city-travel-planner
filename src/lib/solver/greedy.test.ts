import { describe, expect, it } from 'vitest';

import { MUMBAI_POIS } from '@/db/seed/mumbai';
import { estimateTravelSeconds, type Coord } from '../geo';
import { isOpenDuring } from './hours';
import { solveGreedy } from './greedy';
import type { SolveRequest, Solution } from './types';

const COLABA: Coord = { lng: 72.828, lat: 18.9155 };
/** Saturday 3 October 2026, 9am local. */
const SAT_9AM = new Date('2026-10-03T09:00:00.000Z');

function request(overrides: Partial<SolveRequest> = {}): SolveRequest {
  return {
    start: COLABA,
    startAt: SAT_9AM,
    budgetMin: 360,
    interests: [],
    candidates: MUMBAI_POIS,
    travelSeconds: estimateTravelSeconds,
    ...overrides,
  };
}

/** The invariants every solution must satisfy, whatever the algorithm. */
function expectValid(solution: Solution, req: SolveRequest) {
  expect(solution.totalElapsedS).toBeLessThanOrEqual(req.budgetMin * 60);
  expect(solution.slackS).toBeGreaterThanOrEqual(0);

  const ids = solution.stops.map((s) => s.candidate.id);
  expect(new Set(ids).size).toBe(ids.length);

  expect(solution.stops.map((s) => s.seq)).toEqual(solution.stops.map((_, i) => i));

  let cursor = req.startAt.getTime();
  for (const stop of solution.stops) {
    expect(stop.arriveAt.getTime()).toBeGreaterThanOrEqual(cursor);
    expect(stop.departAt.getTime()).toBeGreaterThan(stop.arriveAt.getTime());
    expect(isOpenDuring(stop.candidate.hours, stop.arriveAt, stop.candidate.visitDurationMin))
      .toBe(true);
    cursor = stop.departAt.getTime();
  }

  // The day must end back at the start, after the return leg.
  const lastDeparture = solution.stops.at(-1)?.departAt.getTime() ?? req.startAt.getTime();
  expect(solution.endAt.getTime()).toBe(lastDeparture + solution.returnTravelS * 1000);
}

describe('solveGreedy', () => {
  it('builds a usable day and respects every invariant', () => {
    const req = request();
    const solution = solveGreedy(req);

    expect(solution.stops.length).toBeGreaterThan(2);
    expect(solution.solver).toBe('greedy');
    expectValid(solution, req);
  });

  it('never exceeds the budget, across a range of budgets', () => {
    for (const budgetMin of [60, 120, 180, 240, 300, 360, 480, 600]) {
      const req = request({ budgetMin });
      expectValid(solveGreedy(req), req);
    }
  });

  it('fits more in a longer day', () => {
    const short = solveGreedy(request({ budgetMin: 120 }));
    const long = solveGreedy(request({ budgetMin: 480 }));
    expect(long.stops.length).toBeGreaterThan(short.stops.length);
    expect(long.totalScore).toBeGreaterThan(short.totalScore);
  });

  it('returns an empty day rather than failing when nothing fits', () => {
    const req = request({ budgetMin: 5 });
    const solution = solveGreedy(req);
    expect(solution.stops).toEqual([]);
    expect(solution.totalElapsedS).toBe(0);
    expectValid(solution, req);
  });

  it('handles an empty candidate list', () => {
    const req = request({ candidates: [] });
    const solution = solveGreedy(req);
    expect(solution.stops).toEqual([]);
    expect(solution.rejected).toEqual([]);
  });

  it('honours stated interests', () => {
    const foodie = solveGreedy(request({ interests: ['food'] }));
    const categories = new Set(foodie.stops.flatMap((s) => s.candidate.categories));
    expect(categories.has('food')).toBe(true);
  });

  it('never schedules a place that is shut on arrival', () => {
    // Sassoon Docks closes at 11:00, so an afternoon start can never include it.
    const req = request({ startAt: new Date('2026-10-03T13:00:00.000Z'), budgetMin: 300 });
    const solution = solveGreedy(req);
    expect(solution.stops.map((s) => s.candidate.name)).not.toContain('Sassoon Docks');
    expectValid(solution, req);
  });

  it('always includes locked stops', () => {
    // Haji Ali is well north of Colaba; greedy would not pick it for a short day.
    const req = request({ lockedIds: [27], budgetMin: 300 });
    const solution = solveGreedy(req);
    const locked = solution.stops.find((s) => s.candidate.id === 27);
    expect(locked).toBeDefined();
    expect(locked?.locked).toBe(true);
    expectValid(solution, req);
  });

  it('explains why big-ticket places were left out', () => {
    const solution = solveGreedy(request());
    // Elephanta fits a six-hour budget on its own, but nothing else fits with it.
    const elephanta = solution.rejected.find((r) => r.candidate.id === 35);
    expect(elephanta?.reason).toBe('day-full');
  });

  it('calls a stop too long when it cannot fit even alone', () => {
    // Isolated deliberately: rejections are capped at the highest-scoring few,
    // so against the full candidate set this one falls off the end of the list.
    const elephanta = MUMBAI_POIS.find((p) => p.id === 35)!;
    const solution = solveGreedy(request({ budgetMin: 120, candidates: [elephanta] }));
    expect(solution.stops).toEqual([]);
    expect(solution.rejected[0]?.reason).toBe('too-long');
  });

  it('reports a closed place as closed rather than over budget', () => {
    // Wednesday: Dr Bhau Daji Lad Museum is shut.
    const solution = solveGreedy(
      request({ startAt: new Date('2026-09-30T09:00:00.000Z'), interests: ['art'] }),
    );
    const museum = solution.rejected.find((r) => r.candidate.id === 24);
    if (museum) expect(museum.reason).toBe('closed');
    expect(solution.stops.map((s) => s.candidate.id)).not.toContain(24);
  });

  it('is deterministic', () => {
    const a = solveGreedy(request());
    const b = solveGreedy(request());
    expect(a.stops.map((s) => s.candidate.id)).toEqual(b.stops.map((s) => s.candidate.id));
  });
});
