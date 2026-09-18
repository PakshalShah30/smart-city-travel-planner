import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { haversineMetres } from '../../lib/geo';
import { normalise, takeTop, type OverpassResponse } from './normalise';

const sample = JSON.parse(
  readFileSync('src/db/ingest/fixtures/mumbai-sample.json', 'utf8'),
) as OverpassResponse;

const pois = normalise(sample);
const names = pois.map((p) => p.name);

describe('normalise', () => {
  it('keeps the landmarks', () => {
    for (const landmark of [
      'Gateway of India',
      'Crawford Market',
      'Flora Fountain',
      'Haji Ali Dargah',
    ]) {
      expect(names.some((n) => n.includes(landmark))).toBe(true);
    }
  });

  it('drops anything without a name', () => {
    const unnamed = sample.elements.filter((e) => e.tags && !e.tags.name).length;
    expect(unnamed).toBeGreaterThan(0);
    expect(pois.every((p) => p.name.trim().length > 0)).toBe(true);
  });

  it('gives every place a usable coordinate, including ways and relations', () => {
    expect(pois.length).toBeGreaterThan(0);
    for (const p of pois) {
      expect(Number.isFinite(p.location.lat)).toBe(true);
      expect(Number.isFinite(p.location.lng)).toBe(true);
      expect(Math.abs(p.location.lat)).toBeGreaterThan(0);
    }
  });

  it('prefers the English name over a bilingual one', () => {
    // Tagged name "Gateway of India - गेटवे ऑफ इंडिया", name:en "Gateway of India".
    expect(names).toContain('Gateway of India');
  });

  it('drops categories nobody plans a day around', () => {
    expect(pois.some((p) => p.osmKind === 'tourism=artwork')).toBe(false);
    expect(pois.some((p) => p.osmKind === 'historic=industrial')).toBe(false);
  });

  it('removes duplicate mappings of the same place, but not namesakes', () => {
    // Mumbai has seventeen Hanuman Mandirs. Sharing a name does not make two
    // shrines the same shrine — only being in the same spot does. So this
    // asserts no two survivors share a name AND a location.
    for (let i = 0; i < pois.length; i += 1) {
      for (let j = i + 1; j < pois.length; j += 1) {
        if (pois[i].name !== pois[j].name) continue;
        expect(haversineMetres(pois[i].location, pois[j].location)).toBeGreaterThan(400);
      }
    }
  });

  it('keeps genuine namesakes rather than deleting them', () => {
    // The fixture deliberately contains several "Hanuman Mandir" entries.
    const namesakes = names.filter((n) => n === 'Hanuman Mandir').length;
    expect(namesakes).toBeGreaterThan(1);
  });

  it('ranks notable places above generic ones', () => {
    const gateway = pois.find((p) => p.name === 'Gateway of India');
    const generic = pois.find((p) => p.name === 'Hanuman Mandir');
    expect(gateway).toBeDefined();
    if (generic) expect(gateway!.popularity).toBeGreaterThan(generic.popularity);
  });

  it('scores within 0..10 without everything bunching at the top', () => {
    for (const p of pois) {
      expect(p.popularity).toBeGreaterThanOrEqual(0);
      expect(p.popularity).toBeLessThanOrEqual(10);
    }
    const atCeiling = pois.filter((p) => p.popularity >= 9.99).length;
    expect(atCeiling).toBeLessThanOrEqual(1);
  });

  it('returns places in rank order with sequential ids', () => {
    expect(pois.map((p) => p.id)).toEqual(pois.map((_, i) => i + 1));
    for (let i = 1; i < pois.length; i += 1) {
      expect(pois[i - 1].popularity).toBeGreaterThanOrEqual(pois[i].popularity);
    }
  });

  it('gives everything a dwell time and at least one category', () => {
    for (const p of pois) {
      expect(p.visitDurationMin).toBeGreaterThan(0);
      expect(p.categories.length).toBeGreaterThan(0);
    }
  });

  it('carries a stable source id for re-ingestion', () => {
    for (const p of pois) expect(p.sourceId).toMatch(/^(node|way|relation)\/\d+$/);
  });

  it('is deterministic', () => {
    expect(normalise(sample).map((p) => p.sourceId)).toEqual(pois.map((p) => p.sourceId));
  });
});

describe('takeTop', () => {
  it('caps the set and renumbers it', () => {
    const top = takeTop(pois, 5);
    expect(top).toHaveLength(Math.min(5, pois.length));
    expect(top.map((p) => p.id)).toEqual(top.map((_, i) => i + 1));
  });

  it('keeps the highest-ranked places', () => {
    expect(takeTop(pois, 3)[0].name).toBe(pois[0].name);
  });
});
