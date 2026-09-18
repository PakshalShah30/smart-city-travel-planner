import type { Candidate, SolveRequest, Stop } from './types';
import { isOpenDuring } from './hours';

const SECOND_MS = 1000;

export type Timeline = {
  stops: Array<Omit<Stop, 'score' | 'locked'>>;
  returnTravelS: number;
  endAt: Date;
  totalTravelS: number;
  totalVisitS: number;
  totalElapsedS: number;
};

/**
 * Lay an ordered list of candidates onto the clock and check it is legal.
 *
 * Returns null when the route breaks a hard constraint: a stop that would be
 * closed on arrival, or a day that overruns the budget.
 *
 * Every solver goes through this one function, which is what makes the
 * benchmark fair — no algorithm can win by quietly relaxing a constraint, and
 * the invariant tests only have one implementation to hold to account.
 */
export function buildTimeline(
  order: readonly Candidate[],
  req: SolveRequest,
): Timeline | null {
  const budgetS = req.budgetMin * 60;
  let cursorMs = req.startAt.getTime();
  let prev = req.start;
  let totalTravelS = 0;
  let totalVisitS = 0;

  const stops: Timeline['stops'] = [];

  for (let i = 0; i < order.length; i += 1) {
    const candidate = order[i];
    const travelS = req.travelSeconds(prev, candidate.location);
    const arriveAt = new Date(cursorMs + travelS * SECOND_MS);

    if (!isOpenDuring(candidate.hours, arriveAt, candidate.visitDurationMin)) return null;

    const visitS = candidate.visitDurationMin * 60;
    const departAt = new Date(arriveAt.getTime() + visitS * SECOND_MS);

    stops.push({ candidate, seq: i, arriveAt, departAt, travelFromPrevS: travelS });

    totalTravelS += travelS;
    totalVisitS += visitS;
    cursorMs = departAt.getTime();
    prev = candidate.location;
  }

  const returnTravelS = order.length === 0 ? 0 : req.travelSeconds(prev, req.start);
  const endAt = new Date(cursorMs + returnTravelS * SECOND_MS);
  const totalElapsedS = Math.round((endAt.getTime() - req.startAt.getTime()) / SECOND_MS);

  if (totalElapsedS > budgetS) return null;

  return {
    stops,
    returnTravelS,
    endAt,
    totalTravelS: totalTravelS + returnTravelS,
    totalVisitS,
    totalElapsedS,
  };
}
