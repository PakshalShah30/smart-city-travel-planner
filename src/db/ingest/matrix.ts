/**
 * Builds the pairwise travel-time matrix.
 *
 * This is a one-time job per city. The result lives in Postgres and the running
 * application never calls a routing engine — which is why self-hosting OSRM for
 * an hour is cheaper and simpler than depending on a hosted API forever.
 *
 * Two things keep it affordable. Chunking, because osrm-routed caps how many
 * coordinates one /table request may carry. And pruning, because a matrix grows
 * as N² and most of it is useless: nobody's six-hour day contains a 45-minute
 * leg between consecutive stops, so those pairs are never stored.
 */
import type { Coord } from '../../lib/geo';

/** A point in the matrix. Start points sit here alongside POIs. */
export type MatrixNode = {
  /** Stable key, e.g. "poi:42" or "start:colaba". */
  key: string;
  location: Coord;
};

export type MatrixEntry = {
  fromKey: string;
  toKey: string;
  durationS: number;
  distanceM: number;
};

/** One /table call. Injected so the chunking can be tested without a router. */
export type TableFn = (
  sources: Coord[],
  destinations: Coord[],
) => Promise<{ durations: Array<Array<number | null>>; distances: Array<Array<number | null>> }>;

export type BuildMatrixOptions = {
  /** Pairs slower than this are not stored. 45 minutes by default. */
  maxDurationS?: number;
  /** Coordinates per side of a request. osrm-routed's default cap is 100 total. */
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
};

export type MatrixResult = {
  entries: MatrixEntry[];
  /** Pairs considered, including the ones pruned. */
  pairsConsidered: number;
  pairsPruned: number;
  pairsUnreachable: number;
  requests: number;
};

const chunk = <T,>(xs: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

export async function buildMatrix(
  nodes: readonly MatrixNode[],
  table: TableFn,
  options: BuildMatrixOptions = {},
): Promise<MatrixResult> {
  const maxDurationS = options.maxDurationS ?? 45 * 60;
  const chunkSize = options.chunkSize ?? 50;

  if (chunkSize < 1) throw new RangeError('chunkSize must be at least 1');

  const groups = chunk(nodes, chunkSize);
  const entries: MatrixEntry[] = [];

  let pairsConsidered = 0;
  let pairsPruned = 0;
  let pairsUnreachable = 0;
  let requests = 0;

  const totalRequests = groups.length * groups.length;

  for (const sources of groups) {
    for (const destinations of groups) {
      const { durations, distances } = await table(
        sources.map((n) => n.location),
        destinations.map((n) => n.location),
      );
      requests += 1;
      options.onProgress?.(requests, totalRequests);

      for (let i = 0; i < sources.length; i += 1) {
        for (let j = 0; j < destinations.length; j += 1) {
          const from = sources[i];
          const to = destinations[j];

          // A node's distance to itself is not a leg.
          if (from.key === to.key) continue;

          pairsConsidered += 1;

          const duration = durations[i]?.[j];
          // OSRM returns null when it cannot route between two points at all.
          if (duration == null || !Number.isFinite(duration)) {
            pairsUnreachable += 1;
            continue;
          }

          if (duration > maxDurationS) {
            pairsPruned += 1;
            continue;
          }

          entries.push({
            fromKey: from.key,
            toKey: to.key,
            durationS: Math.round(duration),
            distanceM: Math.round(distances[i]?.[j] ?? 0),
          });
        }
      }
    }
  }

  return { entries, pairsConsidered, pairsPruned, pairsUnreachable, requests };
}

/**
 * Turns matrix entries into the lookup the solver wants.
 *
 * A missing pair means "further apart than we bothered to store", not "free" —
 * returning 0 there would let the solver build impossible days. Callers supply
 * a fallback, normally the straight-line estimate, which always overestimates
 * speed and so stays conservative about what fits.
 */
export function toLookup(
  entries: readonly MatrixEntry[],
): (fromKey: string, toKey: string) => number | undefined {
  const map = new Map<string, number>();
  for (const e of entries) map.set(`${e.fromKey}>${e.toKey}`, e.durationS);
  return (fromKey, toKey) => (fromKey === toKey ? 0 : map.get(`${fromKey}>${toKey}`));
}
