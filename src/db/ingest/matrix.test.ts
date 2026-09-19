import { describe, expect, it, vi } from 'vitest';

import { buildMatrix, toLookup, type MatrixNode, type TableFn } from './matrix';

/** A grid of nodes, far enough apart that indices are easy to reason about. */
const nodes = (n: number): MatrixNode[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `n${i}`,
    location: { lng: 72.8 + i * 0.01, lat: 18.9 + i * 0.01 },
  }));

/**
 * Stands in for OSRM. Durations are derived from the coordinates so each pair
 * has a distinct, asymmetric, predictable value — which is what makes it
 * possible to prove no pair is dropped or swapped by the chunking.
 */
const fakeTable =
  (opts: { nullAt?: (a: number, b: number) => boolean; scale?: number } = {}): TableFn =>
  async (sources, destinations) => {
    const idx = (c: { lng: number }) => Math.round((c.lng - 72.8) * 100);
    const durations = sources.map((s) =>
      destinations.map((d) => {
        const a = idx(s);
        const b = idx(d);
        if (opts.nullAt?.(a, b)) return null;
        // Asymmetric on purpose: one-way streets make real matrices asymmetric.
        return (a * 100 + b) * (opts.scale ?? 1);
      }),
    );
    return { durations, distances: durations.map((r) => r.map((v) => (v ?? 0) * 2)) };
  };

describe('buildMatrix', () => {
  it('considers every ordered pair exactly once, across chunk boundaries', async () => {
    const all = nodes(7);
    const result = await buildMatrix(all, fakeTable(), { chunkSize: 3, maxDurationS: 1e9 });

    expect(result.pairsConsidered).toBe(7 * 6);
    expect(result.entries).toHaveLength(7 * 6);

    const seen = new Set(result.entries.map((e) => `${e.fromKey}>${e.toKey}`));
    expect(seen.size).toBe(7 * 6);
    for (let i = 0; i < 7; i += 1) {
      for (let j = 0; j < 7; j += 1) {
        if (i === j) continue;
        expect(seen.has(`n${i}>n${j}`)).toBe(true);
      }
    }
  });

  it('keeps direction straight, so asymmetric times are not transposed', async () => {
    const result = await buildMatrix(nodes(5), fakeTable(), { chunkSize: 2, maxDurationS: 1e9 });
    const find = (a: number, b: number) =>
      result.entries.find((e) => e.fromKey === `n${a}` && e.toKey === `n${b}`);

    // The fake encodes source and destination as a*100+b.
    expect(find(1, 4)?.durationS).toBe(104);
    expect(find(4, 1)?.durationS).toBe(401);
  });

  it('never stores a node against itself', async () => {
    const result = await buildMatrix(nodes(6), fakeTable(), { chunkSize: 4, maxDurationS: 1e9 });
    expect(result.entries.some((e) => e.fromKey === e.toKey)).toBe(false);
  });

  it('prunes pairs slower than the cap and counts them', async () => {
    const all = nodes(5);
    const unpruned = await buildMatrix(all, fakeTable(), { chunkSize: 5, maxDurationS: 1e9 });
    const pruned = await buildMatrix(all, fakeTable(), { chunkSize: 5, maxDurationS: 250 });

    expect(pruned.entries.length).toBeLessThan(unpruned.entries.length);
    expect(pruned.entries.every((e) => e.durationS <= 250)).toBe(true);
    expect(pruned.pairsPruned).toBe(unpruned.entries.length - pruned.entries.length);
    expect(pruned.pairsConsidered).toBe(unpruned.pairsConsidered);
  });

  it('treats an unroutable pair as missing, not as instant', async () => {
    const result = await buildMatrix(nodes(4), fakeTable({ nullAt: (a, b) => a === 0 && b === 2 }), {
      chunkSize: 4,
      maxDurationS: 1e9,
    });
    expect(result.pairsUnreachable).toBe(1);
    expect(result.entries.find((e) => e.fromKey === 'n0' && e.toKey === 'n2')).toBeUndefined();
  });

  it('issues one request per chunk pair', async () => {
    const table = vi.fn(fakeTable());
    const result = await buildMatrix(nodes(10), table, { chunkSize: 4, maxDurationS: 1e9 });
    // ceil(10/4) = 3 groups, so 9 requests.
    expect(result.requests).toBe(9);
    expect(table).toHaveBeenCalledTimes(9);
  });

  it('reports progress up to completion', async () => {
    const seen: Array<[number, number]> = [];
    await buildMatrix(nodes(6), fakeTable(), {
      chunkSize: 3,
      maxDurationS: 1e9,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.at(-1)).toEqual([4, 4]);
  });

  it('handles a single node and an empty set without dividing by zero', async () => {
    expect((await buildMatrix(nodes(1), fakeTable())).entries).toEqual([]);
    expect((await buildMatrix([], fakeTable())).entries).toEqual([]);
  });

  it('rejects a nonsensical chunk size rather than looping forever', async () => {
    await expect(buildMatrix(nodes(3), fakeTable(), { chunkSize: 0 })).rejects.toThrow(RangeError);
  });
});

describe('toLookup', () => {
  it('returns the stored duration, zero for self, undefined for a pruned pair', async () => {
    const result = await buildMatrix(nodes(4), fakeTable(), { chunkSize: 2, maxDurationS: 150 });
    const lookup = toLookup(result.entries);

    expect(lookup('n0', 'n0')).toBe(0);
    expect(lookup('n0', 'n1')).toBe(1);
    // n3 -> n0 is 300, above the cap, so it was never stored.
    expect(lookup('n3', 'n0')).toBeUndefined();
  });

  it('does not invent a reverse leg', async () => {
    const lookup = toLookup([{ fromKey: 'a', toKey: 'b', durationS: 60, distanceM: 100 }]);
    expect(lookup('a', 'b')).toBe(60);
    expect(lookup('b', 'a')).toBeUndefined();
  });
});
