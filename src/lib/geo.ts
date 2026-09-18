/** Geographic primitives. No PostGIS here — this is the application-side maths. */

export type Coord = {
  /** Degrees east, -180..180. */
  lng: number;
  /** Degrees north, -90..90. */
  lat: number;
};

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS84 points. */
export function haversineMetres(a: Coord, b: Coord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Multiplier turning straight-line distance into plausible street distance.
 * Roughly the ratio of road distance to crow-flight in a dense grid city.
 * Phase 2 replaces this whole estimate with routed times from OSRM.
 */
export const DETOUR_FACTOR = 1.35;

export type TravelMode = 'foot' | 'car';

/** Average speeds in metres per second, including the usual stopping and waiting. */
const SPEED_MPS: Record<TravelMode, number> = {
  foot: 1.25,
  car: 6.5,
};

/** Below this, driving is slower than walking once you account for finding the car. */
const WALK_THRESHOLD_M = 1200;

/**
 * Estimated travel time in seconds.
 *
 * Deliberately crude: it exists so Phase 1 works end to end without a routing
 * engine. Every caller takes this as an injected function, so Phase 2 swaps in
 * matrix lookups without the solver changing at all.
 */
export function estimateTravelSeconds(a: Coord, b: Coord): number {
  const straight = haversineMetres(a, b);
  if (straight === 0) return 0;

  const street = straight * DETOUR_FACTOR;
  const mode: TravelMode = street <= WALK_THRESHOLD_M ? 'foot' : 'car';
  return Math.round(street / SPEED_MPS[mode]);
}

/** Which mode `estimateTravelSeconds` assumed, for display purposes. */
export function estimateTravelMode(a: Coord, b: Coord): TravelMode {
  return haversineMetres(a, b) * DETOUR_FACTOR <= WALK_THRESHOLD_M ? 'foot' : 'car';
}
