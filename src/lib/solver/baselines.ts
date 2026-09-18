/**
 * Naive control solvers.
 *
 * These exist to be beaten. A benchmark that only reports one algorithm's score
 * says nothing — the number is meaningless without something to compare it to,
 * and a harness that has never detected a difference between two solvers has
 * not been shown to work at all.
 */
import { isOpenOnDay } from './hours';
import { scoreCandidate } from './score';
import { buildTimeline } from './timeline';
import {
  DEFAULT_WEIGHTS,
  type Rejection,
  type SolveRequest,
  type Solution,
  type Solver,
  type Stop,
} from './types';

/**
 * Take the best-rated places until the clock runs out.
 *
 * This is the obvious first implementation: rank everything once, walk the list,
 * append anything that still fits. It never reconsiders order and never weighs
 * a detour against what the stop is worth, so it wanders across the city.
 */
export function solvePopularityFirst(req: SolveRequest): Solution {
  const started = Date.now();
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const lockedIds = new Set(req.lockedIds ?? []);

  // Ranked once, up front, with no notion of what the day already contains.
  const ranked = [...req.candidates].sort(
    (a, b) =>
      scoreCandidate(b, req.interests, new Set(), weights) -
      scoreCandidate(a, req.interests, new Set(), weights),
  );

  // Locked stops still have to appear, or the comparison would be unfair.
  const ordered = [
    ...ranked.filter((c) => lockedIds.has(c.id)),
    ...ranked.filter((c) => !lockedIds.has(c.id)),
  ];

  const chosen: typeof ordered = [];
  const skipped: typeof ordered = [];

  for (const candidate of ordered) {
    const next = [...chosen, candidate];
    if (buildTimeline(next, req)) chosen.push(candidate);
    else skipped.push(candidate);
  }

  const timeline = buildTimeline(chosen, req) ?? buildTimeline([], req)!;
  const chosenCategories = new Set(chosen.flatMap((c) => c.categories));

  const stops: Stop[] = timeline.stops.map((s) => ({
    ...s,
    score: scoreCandidate(s.candidate, req.interests, chosenCategories, weights),
    locked: lockedIds.has(s.candidate.id),
  }));

  const rejected: Rejection[] = skipped.slice(0, 8).map((candidate) => ({
    candidate,
    reason: !isOpenOnDay(candidate.hours, req.startAt)
      ? 'closed'
      : buildTimeline([candidate], req)
        ? 'day-full'
        : 'too-long',
  }));

  return {
    stops,
    returnTravelS: timeline.returnTravelS,
    endAt: timeline.endAt,
    totalTravelS: timeline.totalTravelS,
    totalVisitS: timeline.totalVisitS,
    totalElapsedS: timeline.totalElapsedS,
    totalScore: stops.reduce((sum, s) => sum + s.score, 0),
    slackS: req.budgetMin * 60 - timeline.totalElapsedS,
    rejected,
    solver: 'popularity-first',
    solveMs: Date.now() - started,
  };
}

export const POPULARITY_FIRST: Solver = {
  name: 'popularity-first',
  label: 'Popularity first (naive)',
  solve: solvePopularityFirst,
};
