/**
 * Parses the OSM `opening_hours` tag into the structured windows the solver uses.
 *
 * Written against the 212 real values in the Mumbai extract, which range from
 * clean ("Mo-Su 09:00-21:00") through multi-rule ("Mo-Fr 05:00-13:00,15:00-22:00;
 * Sa-Su 05:00-22:00; PH 05:00-22:00") to unparseable ("2hrs", "06:00 am- 10:00 am,
 * 05:00 pm -10:00 pm (Monday to Saturday)").
 *
 * The full opening_hours grammar is far larger than this — month ranges, week
 * numbers, "last Sunday", offsets. This handles the shapes that actually occur
 * and returns `unknown` for everything else rather than guessing. Unknown means
 * "treated as open", because deleting the Gateway of India from every itinerary
 * over a malformed tag is a worse failure than occasionally suggesting somewhere
 * that turns out to be shut.
 */
import type { Hours, OpenWindow } from '../../lib/solver/types';

/** Two-letter forms are the standard; the three-letter ones appear in the wild. */
const DAY_INDEX: Record<string, number> = {
  su: 0, sun: 0,
  mo: 1, mon: 1,
  tu: 2, tue: 2,
  we: 3, wed: 3,
  th: 4, thu: 4,
  fr: 5, fri: 5,
  sa: 6, sat: 6,
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Mumbai sits near 19°N, where daylight runs roughly 06:20–19:00 in June and
 * 07:10–18:00 in December. One fixed window is wrong by up to 40 minutes at the
 * solstices, which is well inside the error of everything else here.
 */
const SUNRISE_SUNSET: [number, number] = [6 * 60 + 30, 18 * 60 + 30];

const clampMinutes = (h: number, m: number) => Math.min(24 * 60, h * 60 + m);

/** "Mo-Fr", "Sa,Su", "Tu" → day indices. Null when it is not a day spec at all. */
function parseDays(spec: string): number[] | null {
  const days = new Set<number>();

  for (const part of spec.split(',')) {
    const token = part.trim().toLowerCase();
    if (!token) return null;

    const range = token.match(/^([a-z]{2,3})-([a-z]{2,3})$/);
    if (range) {
      const from = DAY_INDEX[range[1]];
      const to = DAY_INDEX[range[2]];
      if (from === undefined || to === undefined) return null;
      // Ranges wrap: Sa-Su is Saturday then Sunday, not an empty set.
      for (let i = from; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === to) break;
      }
      continue;
    }

    const single = DAY_INDEX[token];
    if (single === undefined) return null;
    days.add(single);
  }

  return [...days].sort((a, b) => a - b);
}

/** "09:00-21:00,15:00-22:00" → minute pairs. Null when malformed. */
function parseIntervals(spec: string): Array<[number, number]> | null {
  const intervals: Array<[number, number]> = [];

  for (const part of spec.split(',')) {
    const token = part.trim();
    if (token.toLowerCase() === 'off') continue;

    const m = token.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;

    const opens = clampMinutes(Number(m[1]), Number(m[2]));
    let closes = clampMinutes(Number(m[3]), Number(m[4]));

    // Overnight ("18:00-02:00") truncates at midnight: this plans single days.
    if (closes <= opens) closes = 24 * 60;

    intervals.push([opens, closes]);
  }

  return intervals.length > 0 ? intervals : null;
}

export function parseOpeningHours(raw: string | undefined): Hours {
  if (!raw) return { kind: 'unknown' };

  const value = raw.trim();
  if (value === '') return { kind: 'unknown' };

  const lower = value.toLowerCase();
  if (lower === '24/7' || lower === 'mo-su 00:00-24:00') return { kind: 'always' };

  if (lower === 'sunrise-sunset' || lower === 'dawn-dusk') {
    return {
      kind: 'windows',
      windows: ALL_DAYS.map((day) => ({
        day,
        opensMin: SUNRISE_SUNSET[0],
        closesMin: SUNRISE_SUNSET[1],
      })),
    };
  }

  const windows: OpenWindow[] = [];

  for (const rule of value.split(';')) {
    const text = rule.trim();
    if (!text) continue;

    // Public and school holidays are a separate calendar we do not model.
    if (/^(ph|sh)\b/i.test(text)) continue;
    if (/\boff\b/i.test(text) && !/\d/.test(text)) continue;

    // Either "<days> <times>" or bare "<times>", which means every day.
    const split = text.match(/^([A-Za-z,\- ]+?)\s+([\d:,\s-]+)$/);
    const daySpec = split ? split[1] : null;
    const timeSpec = split ? split[2] : text;

    const days = daySpec ? parseDays(daySpec) : ALL_DAYS;
    if (!days) return { kind: 'unknown', raw: value };

    const intervals = parseIntervals(timeSpec);
    if (!intervals) return { kind: 'unknown', raw: value };

    for (const day of days) {
      for (const [opensMin, closesMin] of intervals) {
        windows.push({ day, opensMin, closesMin });
      }
    }
  }

  if (windows.length === 0) return { kind: 'unknown', raw: value };
  return { kind: 'windows', windows };
}
