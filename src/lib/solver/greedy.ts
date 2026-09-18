import { isOpenOnDay } from './hours';
import { buildTimeline, type Timeline } from './timeline';
import { scoreCandidate } from './score';
import {
  DEFAULT_WEIGHTS,
  type Candidate,
  type Rejection,
  type SolveRequest,
  type Solution,
  type Solver,
  type Stop,
} from './types';

/** How many rejected candidates to explain. The rest are noise. */
const MAX_REJECTIONS_REPORTED = 8;

/** Every way to put `candidate` into `order`, cheapest-first is decided by the caller. */
function* insertions(
  order: readonly Candidate[],
  candidate: Candidate,
): Generator<Candidate[]> {
  for (let i = 0; i <= order.length; i += 1) {
    yield [...order.slice(0, i), candidate, ...order.slice(i)];
  }
}

/**
 * Greedy insertion.
 *
 * Repeatedly adds whichever remaining candidate buys the most score per minute
 * it costs, trying every position in the route and keeping the cheapest legal
 * one. Stops when nothing else fits.
 *
 * This is the Phase 1 baseline, and it stays after better solvers arrive: it is
 * the number every later algorithm has to beat on the benchmark.
 */
export function solveGreedy(req: SolveRequest): Solution {
  const started = Date.now();
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const lockedIds = new Set(req.lockedIds ?? []);

  const byId = new Map(req.candidates.map((c) => [c.id, c]));
  const locked = [...lockedIds].map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
  const optional = req.candidates.filter((c) => !lockedIds.has(c.id));

  let order: Candidate[] = [];
  let timeline = buildTimeline(order, req);
  const unplaceableLocked: Candidate[] = [];

  // Locked stops go in first: the user asked for them, so they outrank score.
  for (const candidate of locked) {
    let best: { order: Candidate[]; timeline: Timeline } | null = null;
    for (const next of insertions(order, candidate)) {
      const t = buildTimeline(next, req);
      if (!t) continue;
      if (!best || t.totalElapsedS < best.timeline.totalElapsedS) best = { order: next, timeline: t };
    }
    if (best) {
      order = best.order;
      timeline = best.timeline;
    } else {
      unplaceableLocked.push(candidate);
    }
  }

  const chosenCategories = new Set(order.flatMap((c) => c.categories));
  const remaining = new Set(optional);

  for (;;) {
    let best: {
      candidate: Candidate;
      order: Candidate[];
      timeline: Timeline;
      score: number;
      ratio: number;
    } | null = null;

    const beforeS = timeline?.totalElapsedS ?? 0;

    for (const candidate of remaining) {
      const score = scoreCandidate(candidate, req.interests, chosenCategories, weights);
      if (score <= 0) continue;

      for (const next of insertions(order, candidate)) {
        const t = buildTimeline(next, req);
        if (!t) continue;

        const addedS = t.totalElapsedS - beforeS;
        // A stop that somehow costs nothing is still worth ranking sensibly.
        const ratio = score / Math.max(addedS / 60, 1 / 60);

        if (!best || ratio > best.ratio) {
          best = { candidate, order: next, timeline: t, score, ratio };
        }
      }
    }

    if (!best) break;

    order = best.order;
    timeline = best.timeline;
    remaining.delete(best.candidate);
    for (const c of best.candidate.categories) chosenCategories.add(c);
  }

  const final = timeline ?? buildTimeline([], req)!;

  const scores = new Map(
    order.map((c) => [
      c.id,
      scoreCandidate(c, req.interests, new Set(chosenCategories), weights),
    ]),
  );

  const stops: Stop[] = final.stops.map((s) => ({
    ...s,
    score: scores.get(s.candidate.id) ?? 0,
    locked: lockedIds.has(s.candidate.id),
  }));

  return {
    stops,
    returnTravelS: final.returnTravelS,
    endAt: final.endAt,
    totalTravelS: final.totalTravelS,
    totalVisitS: final.totalVisitS,
    totalElapsedS: final.totalElapsedS,
    totalScore: stops.reduce((sum, s) => sum + s.score, 0),
    slackS: req.budgetMin * 60 - final.totalElapsedS,
    rejected: explainRejections([...remaining, ...unplaceableLocked], order, req, weights),
    solver: 'greedy',
    solveMs: Date.now() - started,
  };
}

/**
 * Work out why the strongest leftovers did not make it.
 *
 * The search above only stops once nothing has a legal insertion left, so by
 * construction every leftover failed for one of three reasons, checked cheapest
 * first. Note that `day-full` is the common case and is not a failure: it means
 * the day filled up with better-value stops.
 */
function explainRejections(
  leftovers: readonly Candidate[],
  order: readonly Candidate[],
  req: SolveRequest,
  weights: SolveRequest['weights'],
): Rejection[] {
  const chosen = new Set(order.flatMap((c) => c.categories));

  return leftovers
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, req.interests, chosen, weights),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_REJECTIONS_REPORTED)
    .map(({ candidate }): Rejection => {
      if (!isOpenOnDay(candidate.hours, req.startAt)) {
        return { candidate, reason: 'closed' };
      }
      // Would it fit even as the only stop of the day?
      const alone = buildTimeline([candidate], req);
      if (!alone) return { candidate, reason: 'too-long' };
      return { candidate, reason: 'day-full' };
    });
}

export const GREEDY: Solver = {
  name: 'greedy',
  label: 'Greedy insertion',
  solve: solveGreedy,
};
