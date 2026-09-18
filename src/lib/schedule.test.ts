import { describe, expect, it } from 'vitest';

import {
  buildSchedule,
  fitsBudget,
  formatDuration,
  slackSeconds,
  type PlannedStop,
} from './schedule';

const START = new Date('2026-10-03T09:00:00.000Z');

/** The five-stop Mumbai day used throughout the mockups. */
const MUMBAI_DAY: PlannedStop[] = [
  { poiId: 1, visitDurationMin: 45, travelFromPrevS: 8 * 60 },
  { poiId: 2, visitDurationMin: 75, travelFromPrevS: 12 * 60 },
  { poiId: 3, visitDurationMin: 40, travelFromPrevS: 9 * 60 },
  { poiId: 4, visitDurationMin: 35, travelFromPrevS: 11 * 60 },
  { poiId: 5, visitDurationMin: 50, travelFromPrevS: 14 * 60 },
];
const RETURN_S = 26 * 60;

describe('buildSchedule', () => {
  it('places the first stop after its travel leg', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    expect(s.stops[0].arriveAt.toISOString()).toBe('2026-10-03T09:08:00.000Z');
    expect(s.stops[0].departAt.toISOString()).toBe('2026-10-03T09:53:00.000Z');
  });

  it('chains each stop off the previous departure', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    expect(s.stops[1].arriveAt.toISOString()).toBe('2026-10-03T10:05:00.000Z');
    expect(s.stops[4].arriveAt.toISOString()).toBe('2026-10-03T13:09:00.000Z');
    expect(s.stops[4].departAt.toISOString()).toBe('2026-10-03T13:59:00.000Z');
  });

  it('numbers stops from zero in order', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    expect(s.stops.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('adds the return leg to reach the end time', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    expect(s.endAt.toISOString()).toBe('2026-10-03T14:25:00.000Z');
    expect(s.totalElapsedS).toBe(5 * 3600 + 25 * 60);
  });

  it('totals travel and visit time separately', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    expect(s.totalTravelS).toBe((8 + 12 + 9 + 11 + 14 + 26) * 60);
    expect(s.totalVisitS).toBe((45 + 75 + 40 + 35 + 50) * 60);
    expect(s.totalTravelS + s.totalVisitS).toBe(s.totalElapsedS);
  });

  it('handles an empty plan as a no-op day', () => {
    const s = buildSchedule(START, [], 0);
    expect(s.stops).toEqual([]);
    expect(s.endAt.toISOString()).toBe(START.toISOString());
    expect(s.totalElapsedS).toBe(0);
  });

  it('rejects negative durations rather than producing time travel', () => {
    expect(() => buildSchedule(START, [{ poiId: 1, visitDurationMin: -5, travelFromPrevS: 0 }], 0))
      .toThrow(RangeError);
    expect(() => buildSchedule(START, [{ poiId: 1, visitDurationMin: 5, travelFromPrevS: -1 }], 0))
      .toThrow(RangeError);
    expect(() => buildSchedule(START, [], -1)).toThrow(RangeError);
  });

  it('never moves a stop earlier than the one before it', () => {
    const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);
    for (let i = 1; i < s.stops.length; i += 1) {
      expect(s.stops[i].arriveAt.getTime()).toBeGreaterThanOrEqual(
        s.stops[i - 1].departAt.getTime(),
      );
    }
  });
});

describe('fitsBudget', () => {
  const s = buildSchedule(START, MUMBAI_DAY, RETURN_S);

  it('accepts a plan inside the budget', () => {
    expect(fitsBudget(s, 360)).toBe(true);
    expect(slackSeconds(s, 360)).toBe(35 * 60);
  });

  it('accepts a plan that exactly fills the budget', () => {
    expect(fitsBudget(s, 325)).toBe(true);
    expect(slackSeconds(s, 325)).toBe(0);
  });

  it('rejects a plan one minute over', () => {
    expect(fitsBudget(s, 324)).toBe(false);
    expect(slackSeconds(s, 324)).toBe(-60);
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(5 * 3600 + 25 * 60)).toBe('5h 25m');
  });

  it('drops the hour part below an hour', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
  });

  it('drops the minute part on a whole hour', () => {
    expect(formatDuration(2 * 3600)).toBe('2h');
  });

  it('floors partial minutes and handles zero and negatives', () => {
    expect(formatDuration(119)).toBe('1m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-90)).toBe('-1m');
  });
});
