import { describe, expect, it } from 'vitest';

import { estimateTravelMode, estimateTravelSeconds, haversineMetres, type Coord } from './geo';

const GATEWAY: Coord = { lng: 72.8347, lat: 18.922 };
const MARINE_DRIVE: Coord = { lng: 72.823, lat: 18.944 };
const CHOWPATTY: Coord = { lng: 72.8156, lat: 18.9547 };

describe('haversineMetres', () => {
  it('measures a known short city hop', () => {
    // Gateway of India to Marine Drive is a little under 3 km as the crow flies.
    const d = haversineMetres(GATEWAY, MARINE_DRIVE);
    expect(d).toBeGreaterThan(2600);
    expect(d).toBeLessThan(2900);
  });

  it('is zero for the same point', () => {
    expect(haversineMetres(GATEWAY, GATEWAY)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMetres(GATEWAY, CHOWPATTY)).toBeCloseTo(
      haversineMetres(CHOWPATTY, GATEWAY),
      6,
    );
  });

  it('obeys the triangle inequality on a real triple', () => {
    const direct = haversineMetres(GATEWAY, CHOWPATTY);
    const viaMarine =
      haversineMetres(GATEWAY, MARINE_DRIVE) + haversineMetres(MARINE_DRIVE, CHOWPATTY);
    expect(direct).toBeLessThanOrEqual(viaMarine + 1e-6);
  });
});

describe('estimateTravelSeconds', () => {
  it('is zero for the same point', () => {
    expect(estimateTravelSeconds(GATEWAY, GATEWAY)).toBe(0);
  });

  it('walks short hops and drives long ones', () => {
    const near: Coord = { lng: GATEWAY.lng + 0.004, lat: GATEWAY.lat };
    expect(estimateTravelMode(GATEWAY, near)).toBe('foot');
    expect(estimateTravelMode(GATEWAY, CHOWPATTY)).toBe('car');
  });

  it('grows with distance', () => {
    const near = estimateTravelSeconds(GATEWAY, MARINE_DRIVE);
    const far = estimateTravelSeconds(GATEWAY, CHOWPATTY);
    expect(far).toBeGreaterThan(near);
  });

  it('returns whole seconds', () => {
    const s = estimateTravelSeconds(GATEWAY, MARINE_DRIVE);
    expect(Number.isInteger(s)).toBe(true);
  });
});
