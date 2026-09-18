/**
 * Turning a chosen sequence of stops into a timed schedule.
 *
 * This is deliberately separate from the solver. The solver decides WHICH stops
 * and in WHAT ORDER; this module decides WHEN, and is the single place that
 * answers "does this plan actually fit the budget?". Keeping it independent means
 * the budget invariant can be asserted against any solver, including future ones.
 */

export type PlannedStop = {
  poiId: number;
  visitDurationMin: number;
  /** Travel from the previous stop, or from the start point for the first stop. */
  travelFromPrevS: number;
};

export type ScheduledStop = PlannedStop & {
  seq: number;
  arriveAt: Date;
  departAt: Date;
};

export type Schedule = {
  startAt: Date;
  endAt: Date;
  stops: ScheduledStop[];
  /** Travel from the last stop back to the start point. */
  returnTravelS: number;
  totalTravelS: number;
  totalVisitS: number;
  /** Wall-clock seconds from leaving the start point to arriving back. */
  totalElapsedS: number;
};

const SECOND_MS = 1000;

/**
 * Lay a sequence of stops onto the clock.
 *
 * Assumes stops are already in visiting order. Travel and visit times are taken
 * at face value; feasibility is a separate question, answered by `fitsBudget`.
 */
export function buildSchedule(
  startAt: Date,
  stops: readonly PlannedStop[],
  returnTravelS: number,
): Schedule {
  if (!Number.isFinite(startAt.getTime())) {
    throw new RangeError('startAt must be a valid Date');
  }
  if (returnTravelS < 0) {
    throw new RangeError('returnTravelS must not be negative');
  }

  let cursorMs = startAt.getTime();
  let totalTravelS = 0;
  let totalVisitS = 0;

  const scheduled: ScheduledStop[] = stops.map((stop, index) => {
    if (stop.travelFromPrevS < 0) {
      throw new RangeError(`travelFromPrevS must not be negative (stop ${index})`);
    }
    if (stop.visitDurationMin < 0) {
      throw new RangeError(`visitDurationMin must not be negative (stop ${index})`);
    }

    const visitS = stop.visitDurationMin * 60;
    cursorMs += stop.travelFromPrevS * SECOND_MS;
    const arriveAt = new Date(cursorMs);
    cursorMs += visitS * SECOND_MS;
    const departAt = new Date(cursorMs);

    totalTravelS += stop.travelFromPrevS;
    totalVisitS += visitS;

    return { ...stop, seq: index, arriveAt, departAt };
  });

  totalTravelS += returnTravelS;
  const endAt = new Date(cursorMs + returnTravelS * SECOND_MS);

  return {
    startAt,
    endAt,
    stops: scheduled,
    returnTravelS,
    totalTravelS,
    totalVisitS,
    totalElapsedS: Math.round((endAt.getTime() - startAt.getTime()) / SECOND_MS),
  };
}

/** True when the whole round trip fits inside the user's time budget. */
export function fitsBudget(schedule: Schedule, budgetMin: number): boolean {
  return schedule.totalElapsedS <= budgetMin * 60;
}

/** Whatever is left of the budget, in seconds. Negative means over. */
export function slackSeconds(schedule: Schedule, budgetMin: number): number {
  return budgetMin * 60 - schedule.totalElapsedS;
}

/** "5h 25m", "45m", "2h". Rounds down to the minute. */
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const minutes = Math.floor(Math.abs(totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${sign}${rest}m`;
  if (rest === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${rest}m`;
}
