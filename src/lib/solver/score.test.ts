import { describe, expect, it } from 'vitest';

import { interestScore, scoreCandidate, varietyScore } from './score';
import type { Candidate } from './types';

const museum: Candidate = {
  id: 1,
  name: 'A museum',
  location: { lng: 72.83, lat: 18.92 },
  visitDurationMin: 60,
  popularity: 8,
  categories: ['art', 'history'],
  hours: { kind: 'always' },
};

describe('interestScore', () => {
  it('is neutral when the user stated no interests', () => {
    expect(interestScore(museum, [])).toBe(5);
  });

  it('is zero when nothing matches', () => {
    expect(interestScore(museum, ['food'])).toBe(0);
  });

  it('rewards a match, and a second match by less', () => {
    const one = interestScore(museum, ['art']);
    const two = interestScore(museum, ['art', 'history']);
    expect(one).toBe(7);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThanOrEqual(10);
  });
});

describe('varietyScore', () => {
  it('is highest for a wholly new kind of stop', () => {
    expect(varietyScore(museum, new Set())).toBe(10);
  });

  it('is lower when partially covered', () => {
    expect(varietyScore(museum, new Set(['art']))).toBe(6);
  });

  it('is zero when the day already has all of it', () => {
    expect(varietyScore(museum, new Set(['art', 'history']))).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('stays inside 0..10', () => {
    const high = scoreCandidate({ ...museum, popularity: 10 }, ['art', 'history'], new Set());
    const low = scoreCandidate({ ...museum, popularity: 0 }, ['food'], new Set(['art', 'history']));
    expect(high).toBeLessThanOrEqual(10);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeGreaterThan(low);
  });

  it('clamps out-of-range popularity rather than trusting the data', () => {
    const absurd = scoreCandidate({ ...museum, popularity: 99 }, [], new Set());
    const capped = scoreCandidate({ ...museum, popularity: 10 }, [], new Set());
    expect(absurd).toBe(capped);
  });
});
