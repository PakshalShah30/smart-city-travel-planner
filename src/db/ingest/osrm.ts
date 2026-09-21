/**
 * Minimal client for a locally running osrm-routed.
 *
 * Only /table is needed. Coordinates go in the URL as lon,lat pairs, which is
 * why requests are chunked — osrm-routed refuses tables larger than its
 * --max-table-size, and long URLs get awkward well before that.
 */
import type { Coord } from '../../lib/geo';
import type { TableFn } from './matrix';

const asCoord = (c: Coord) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`;

export type OsrmOptions = {
  baseUrl?: string;
  profile?: string;
  /** Retries transient failures; OSRM occasionally drops a request under load. */
  retries?: number;
};

export function createOsrmTable(options: OsrmOptions = {}): TableFn {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:5100').replace(/\/$/, '');
  const profile = options.profile ?? 'driving';
  const retries = options.retries ?? 2;

  return async function table(sources, destinations) {
    const coords = [...sources, ...destinations].map(asCoord).join(';');
    const sourceIdx = sources.map((_, i) => i).join(';');
    const destIdx = destinations.map((_, i) => sources.length + i).join(';');
    const url =
      `${baseUrl}/table/v1/${profile}/${coords}` +
      `?sources=${sourceIdx}&destinations=${destIdx}&annotations=duration,distance`;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`OSRM responded ${res.status}: ${await res.text()}`);

        const body = (await res.json()) as {
          code: string;
          durations?: Array<Array<number | null>>;
          distances?: Array<Array<number | null>>;
          message?: string;
        };

        if (body.code !== 'Ok') throw new Error(`OSRM: ${body.code} ${body.message ?? ''}`);
        if (!body.durations) throw new Error('OSRM returned no durations');

        return {
          durations: body.durations,
          distances: body.distances ?? body.durations.map((row) => row.map(() => 0)),
        };
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }

    throw new Error(
      `OSRM /table failed after ${retries + 1} attempts. Is osrm-routed running at ${baseUrl}? ` +
        `Original error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  };
}
