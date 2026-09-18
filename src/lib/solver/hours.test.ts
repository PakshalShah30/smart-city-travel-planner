import { describe, expect, it } from 'vitest';

import { dailyWindow, dailyWindowExcept, isOpenDuring, isOpenOnDay } from './hours';

// Saturday 3 October 2026, 10:00 local (expressed as UTC by convention).
const SAT_10AM = new Date('2026-10-03T10:00:00.000Z');
const SAT_8PM = new Date('2026-10-03T20:00:00.000Z');
const WED_10AM = new Date('2026-09-30T10:00:00.000Z');

describe('isOpenDuring', () => {
  it('treats always-open and unknown hours as open', () => {
    expect(isOpenDuring({ kind: 'always' }, SAT_10AM, 60)).toBe(true);
    expect(isOpenDuring({ kind: 'unknown' }, SAT_10AM, 60)).toBe(true);
  });

  it('accepts a visit that finishes before closing', () => {
    expect(isOpenDuring(dailyWindow(9 * 60, 18 * 60), SAT_10AM, 90)).toBe(true);
  });

  it('rejects a visit that would overrun closing time', () => {
    // Opens 09:00, closes 10:30; a 90-minute visit from 10:00 runs 60 minutes over.
    expect(isOpenDuring(dailyWindow(9 * 60, 10 * 60 + 30), SAT_10AM, 90)).toBe(false);
  });

  it('rejects arrival before opening', () => {
    expect(isOpenDuring(dailyWindow(11 * 60, 18 * 60), SAT_10AM, 30)).toBe(false);
  });

  it('rejects a day the place is closed', () => {
    const closedWednesday = dailyWindowExcept(9 * 60, 18 * 60, [3]);
    expect(isOpenDuring(closedWednesday, WED_10AM, 30)).toBe(false);
    expect(isOpenDuring(closedWednesday, SAT_10AM, 30)).toBe(true);
  });

  it('rejects a visit that would run past midnight', () => {
    expect(isOpenDuring(dailyWindow(0, 24 * 60), SAT_8PM, 5 * 60)).toBe(false);
  });
});

describe('isOpenOnDay', () => {
  it('reports whether the place opens at all that day', () => {
    const closedWednesday = dailyWindowExcept(9 * 60, 18 * 60, [3]);
    expect(isOpenOnDay(closedWednesday, WED_10AM)).toBe(false);
    expect(isOpenOnDay(closedWednesday, SAT_10AM)).toBe(true);
    expect(isOpenOnDay({ kind: 'always' }, WED_10AM)).toBe(true);
  });
});
