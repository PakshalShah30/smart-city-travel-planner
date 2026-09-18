import { describe, expect, it } from 'vitest';

import { isOpenDuring } from '../../lib/solver/hours';
import { parseOpeningHours } from './hours';

/** Saturday 3 October 2026, local wall-clock as UTC (the solver's convention). */
const sat = (hhmm: string) => new Date(`2026-10-03T${hhmm}:00.000Z`);
const mon = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`);

describe('parseOpeningHours', () => {
  it('treats a missing or empty tag as unknown', () => {
    expect(parseOpeningHours(undefined).kind).toBe('unknown');
    expect(parseOpeningHours('   ').kind).toBe('unknown');
  });

  it('reads 24/7 as always open', () => {
    expect(parseOpeningHours('24/7')).toEqual({ kind: 'always' });
  });

  it('approximates sunrise-sunset as a daylight window every day', () => {
    const h = parseOpeningHours('sunrise-sunset');
    expect(h.kind).toBe('windows');
    if (h.kind !== 'windows') return;
    expect(h.windows).toHaveLength(7);
    expect(isOpenDuring(h, sat('10:00'), 60)).toBe(true);
    expect(isOpenDuring(h, sat('21:00'), 30)).toBe(false);
  });

  it('expands a day range across every day it covers', () => {
    const h = parseOpeningHours('Mo-Su 09:00-21:00');
    expect(h.kind === 'windows' && h.windows).toHaveLength(7);
  });

  it('excludes the day a range skips', () => {
    // Tu-Su is closed Monday — the single most common real closure.
    const h = parseOpeningHours('Tu-Su 10:00-20:00');
    expect(h.kind === 'windows' && h.windows).toHaveLength(6);
    expect(isOpenDuring(h, mon('11:00'), 60)).toBe(false);
    expect(isOpenDuring(h, sat('11:00'), 60)).toBe(true);
  });

  it('wraps a range that crosses the end of the week', () => {
    const h = parseOpeningHours('Sa-Su 05:00-22:00');
    expect(h.kind === 'windows' && h.windows.map((w) => w.day).sort()).toEqual([0, 6]);
  });

  it('treats a bare time range as every day', () => {
    const h = parseOpeningHours('10:00-22:00');
    expect(h.kind === 'windows' && h.windows).toHaveLength(7);
  });

  it('handles several rules, several intervals, and skips public holidays', () => {
    const h = parseOpeningHours(
      'Mo-Fr 05:00-13:00,15:00-22:00; Sa-Su 05:00-22:00; PH 05:00-22:00',
    );
    // Five weekdays with two intervals each, plus one interval on each weekend day.
    expect(h.kind === 'windows' && h.windows).toHaveLength(12);
    expect(isOpenDuring(h, mon('14:00'), 30)).toBe(false);
    expect(isOpenDuring(h, mon('16:00'), 30)).toBe(true);
  });

  it('accepts three-letter day names, which appear in the wild', () => {
    expect(parseOpeningHours('Mon-Sun 05:15-21:15').kind).toBe('windows');
    expect(parseOpeningHours('mo-sun 6:00-19:00').kind).toBe('windows');
  });

  it('truncates an overnight range at midnight rather than inverting it', () => {
    const h = parseOpeningHours('Mo-Su 18:00-02:00');
    expect(h.kind === 'windows' && h.windows[0]).toMatchObject({
      opensMin: 18 * 60,
      closesMin: 24 * 60,
    });
  });

  it('gives up on genuinely malformed values, keeping the original', () => {
    for (const bad of [
      '2hrs',
      '06:00 am- 10:00 am, 05:00 pm -10:00 pm (Monday to Saturday)',
      'Mo-Su 06:00AM-21:00PM',
    ]) {
      const h = parseOpeningHours(bad);
      expect(h.kind).toBe('unknown');
      expect(h.kind === 'unknown' && h.raw).toBe(bad);
    }
  });

  it('never invents a window it cannot justify', () => {
    // Unknown must mean unknown, so downstream can decide to treat it as open.
    const h = parseOpeningHours('whenever the caretaker is around');
    expect(h.kind).toBe('unknown');
  });
});
