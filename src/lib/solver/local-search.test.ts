import { describe, expect, it } from 'vitest';

import { MUMBAI_POIS } from '../../db/seed/mumbai';
import { estimateTravelSeconds, type Coord } from '../geo';
import { isOpenDuring } from './hours';
import { solveGreedy } from './greedy';
import { buildTimeline } from './timeline';
import {
  DEFAULT_MOVES,
  GREEDY_LOCAL,
  improve,
  solveGreedyLocal,
  solveGreedyLocalWithStats,
} from './local-search';
import type { SolveRequest, Solution } from './types';

const COLABA: Coord = { lng: 72.828, lat: 18.9155 };
/** Saturday 3 October 2026, 9am local. */
const SAT_9AM = new Date('2026-10-03T09:00:00.000Z');

/** Every move switched off. The control: this must reproduce greedy exactly. */
const NO_MOVES = { twoOpt: false, orOpt: false, insert: false, swap: false, eject: false };

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

/** The same invariants greedy.test.ts holds its solver to. */
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

  const lastDeparture = solution.stops.at(-1)?.departAt.getTime() ?? req.startAt.getTime();
  expect(solution.endAt.getTime()).toBe(lastDeparture + solution.returnTravelS * 1000);
}

const BUDGETS = [60, 120, 180, 240, 300, 360, 480, 600];
const DATES = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11'];

describe('solveGreedyLocal', () => {
  it('respects every invariant, across budgets and days', () => {
    for (const budgetMin of BUDGETS) {
      for (const date of DATES) {
        const req = request({ budgetMin, startAt: new Date(`${date}T09:00:00.000Z`) });
        expectValid(solveGreedyLocal(req), req);
      }
    }
  });

  it('is never worse than the greedy solution it starts from', () => {
    for (const budgetMin of BUDGETS) {
      for (const date of DATES) {
        const req = request({ budgetMin, startAt: new Date(`${date}T09:00:00.000Z`) });
        // Not a hope, a guarantee: every move is committed only on a strict
        // score gain, or on a strictly shorter day at an unchanged score.
        expect(solveGreedyLocal(req).totalScore).toBeGreaterThanOrEqual(
          solveGreedy(req).totalScore - 1e-9,
        );
      }
    }
  });

  it('actually improves on greedy on a full day', () => {
    const req = request({ budgetMin: 600 });
    expect(solveGreedyLocal(req).totalScore).toBeGreaterThan(solveGreedy(req).totalScore);
  });

  it('reproduces greedy exactly when every move is disabled', () => {
    // The control for "did it improve, or did it just start somewhere else?".
    for (const budgetMin of BUDGETS) {
      const req = request({ budgetMin });
      const greedy = solveGreedy(req);
      const { solution } = solveGreedyLocalWithStats(req, NO_MOVES);
      expect(solution.stops.map((s) => s.candidate.id)).toEqual(
        greedy.stops.map((s) => s.candidate.id),
      );
      expect(solution.totalScore).toBeCloseTo(greedy.totalScore, 10);
      expect(solution.totalElapsedS).toBe(greedy.totalElapsedS);
    }
  });

  it('reorders without changing the score, and shortens the day when it does', () => {
    // The whole reason 2-opt cannot pay for itself directly: the objective is
    // the value of the SET of stops, so reversing a segment is score-neutral.
    const req = request({ budgetMin: 300, startAt: new Date('2026-10-10T08:00:00.000Z') });
    const greedy = solveGreedy(req);
    const { solution, stats } = solveGreedyLocalWithStats(req, {
      ...NO_MOVES,
      twoOpt: true,
      orOpt: true,
    });

    expect(stats.twoOptApplied + stats.orOptApplied).toBeGreaterThan(0);
    expect(solution.stops.map((s) => s.candidate.id).sort()).toEqual(
      greedy.stops.map((s) => s.candidate.id).sort(),
    );
    expect(solution.totalScore).toBeCloseTo(greedy.totalScore, 10);
    expect(solution.totalElapsedS).toBeLessThan(greedy.totalElapsedS);
  });

  it('spends the time it frees rather than banking it', () => {
    const req = request({ budgetMin: 600 });
    expect(solveGreedyLocal(req).slackS).toBeLessThanOrEqual(solveGreedy(req).slackS);
  });

  it('never drops a locked stop', () => {
    for (const budgetMin of [180, 300, 480, 600]) {
      for (const lockedIds of [[27], [35], [1, 27, 35]]) {
        const req = request({ budgetMin, lockedIds });
        const greedy = solveGreedy(req);
        const local = solveGreedyLocal(req);
        const kept = new Set(local.stops.map((s) => s.candidate.id));
        for (const stop of greedy.stops.filter((s) => s.locked)) {
          expect(kept.has(stop.candidate.id)).toBe(true);
        }
        expect(local.stops.filter((s) => s.locked).map((s) => s.candidate.id).sort()).toEqual(
          greedy.stops.filter((s) => s.locked).map((s) => s.candidate.id).sort(),
        );
        expectValid(local, req);
      }
    }
  });

  it('is deterministic', () => {
    const req = request({ budgetMin: 600 });
    const a = solveGreedyLocal(req);
    const b = solveGreedyLocal(req);
    expect(a.stops.map((s) => s.candidate.id)).toEqual(b.stops.map((s) => s.candidate.id));
    expect(a.totalScore).toBe(b.totalScore);
  });

  it('reports a timeline that is the timeline of the order it chose', () => {
    const req = request({ budgetMin: 480 });
    const solution = solveGreedyLocal(req);
    const rebuilt = buildTimeline(solution.stops.map((s) => s.candidate), req);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.totalElapsedS).toBe(solution.totalElapsedS);
    expect(rebuilt!.endAt.getTime()).toBe(solution.endAt.getTime());
  });

  it('stops at the evaluation budget instead of running away', () => {
    const req = request({ budgetMin: 600 });
    const { solution, stats } = solveGreedyLocalWithStats(req, { maxEvaluations: 50 });
    expect(stats.evaluations).toBeLessThanOrEqual(50);
    expect(stats.budgetExhausted).toBe(true);
    // A truncated search still returns a legal plan, just a less good one.
    expectValid(solution, req);
  });

  it('converges well inside its caps on the scenarios it is built for', () => {
    const { stats } = solveGreedyLocalWithStats(request({ budgetMin: 600 }));
    expect(stats.budgetExhausted).toBe(false);
    expect(stats.passes).toBeLessThan(DEFAULT_MOVES.maxPasses);
  });

  it('handles an empty day and an empty candidate list', () => {
    const empty = request({ candidates: [] });
    expect(solveGreedyLocal(empty).stops).toEqual([]);
    expect(solveGreedyLocal(empty).rejected).toEqual([]);

    const tiny = request({ budgetMin: 5 });
    expect(solveGreedyLocal(tiny).stops).toEqual([]);
    expect(solveGreedyLocal(tiny).totalElapsedS).toBe(0);
  });

  it('falls back to an empty day if handed an order that is not feasible', () => {
    const req = request({ budgetMin: 30 });
    const overstuffed = MUMBAI_POIS.slice(0, 10);
    const { order, timeline } = improve(overstuffed, req);
    expect(order).toEqual([]);
    expect(timeline.stops).toEqual([]);
  });

  it('is registered under its own solver name', () => {
    expect(GREEDY_LOCAL.name).toBe('greedy+local');
    expect(solveGreedyLocal(request()).solver).toBe('greedy+local');
  });
});
