/**
 * Turns a raw Overpass extract into candidate places.
 *
 * The Mumbai extract is 3,060 elements, and most of it is not somewhere you
 * would spend an afternoon: 1,177 have no name at all, and of what remains there
 * are 742 places of worship and 657 parks — seventeen "Hanuman Mandir", ten "BMC
 * Park". Those are neighbourhood shrines and pocket gardens, correctly mapped and
 * useless in an itinerary.
 *
 * OSM carries no ratings, so the ranking problem is real: nothing in the tags
 * separates the Siddhivinayak Temple from a shrine on a side street. The one
 * strong signal available is notability — a Wikipedia article or Wikidata entry.
 * Only ~80 elements have one, but they are almost exactly the right ~80: Gateway
 * of India, Elephanta Caves, Haji Ali, Bhau Daji Lad, Flora Fountain, Crawford
 * Market. So notability drives the pre-ranking, and Google Places enrichment
 * (real ratings) is applied to the top of that list rather than to all 1,883.
 */
import type { Candidate } from '../../lib/solver/types';
import { parseOpeningHours } from './hours';

export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassResponse = { elements: OverpassElement[] };

export type IngestedPoi = Candidate & {
  /** Stable identity across re-ingests, e.g. "way/28845634". */
  sourceId: string;
  /** Kept for debugging the mapping below. */
  osmKind: string;
  notable: boolean;
};

/** What a kind of place is worth and how long people spend there. */
type KindSpec = { category: string; baseScore: number; visitMin: number };

/**
 * Tag value to category, dwell time and a starting score.
 * Anything not listed here is dropped — see DROPPED below for why.
 */
const KINDS: Record<string, KindSpec> = {
  'tourism=museum': { category: 'art', baseScore: 6.5, visitMin: 75 },
  'tourism=gallery': { category: 'art', baseScore: 5.5, visitMin: 45 },
  'tourism=attraction': { category: 'history', baseScore: 6.0, visitMin: 40 },
  'tourism=viewpoint': { category: 'views', baseScore: 5.5, visitMin: 20 },
  'tourism=zoo': { category: 'family', baseScore: 6.5, visitMin: 90 },
  'tourism=aquarium': { category: 'family', baseScore: 6.0, visitMin: 60 },
  'tourism=theme_park': { category: 'family', baseScore: 6.5, visitMin: 120 },

  'historic=monument': { category: 'history', baseScore: 5.0, visitMin: 20 },
  'historic=fort': { category: 'history', baseScore: 6.0, visitMin: 45 },
  'historic=ruins': { category: 'history', baseScore: 4.5, visitMin: 30 },
  'historic=memorial': { category: 'history', baseScore: 3.5, visitMin: 15 },
  'historic=building': { category: 'history', baseScore: 4.5, visitMin: 20 },
  'historic=archaeological_site': { category: 'history', baseScore: 5.5, visitMin: 45 },
  'historic=yes': { category: 'history', baseScore: 4.0, visitMin: 20 },

  'leisure=park': { category: 'parks', baseScore: 4.0, visitMin: 35 },
  'leisure=garden': { category: 'parks', baseScore: 3.5, visitMin: 25 },
  'leisure=nature_reserve': { category: 'parks', baseScore: 6.0, visitMin: 90 },

  'amenity=place_of_worship': { category: 'religious', baseScore: 4.0, visitMin: 25 },
  'amenity=marketplace': { category: 'markets', baseScore: 4.5, visitMin: 40 },
  'amenity=theatre': { category: 'art', baseScore: 4.0, visitMin: 30 },
  'amenity=arts_centre': { category: 'art', baseScore: 4.5, visitMin: 40 },

  'natural=beach': { category: 'views', baseScore: 5.5, visitMin: 45 },
};

/**
 * Matched by the query but never worth visiting, so dropped rather than scored
 * low. `historic=industrial` is 31 mill chimneys; `tourism=artwork` is 63 murals
 * and statues that are pleasant to pass and not worth routing a day around.
 */
const DROPPED = new Set([
  'tourism=artwork',
  'historic=industrial',
  'historic=wayside_cross',
  'historic=wayside_shrine',
  'historic=tomb',
  'natural=cave_entrance',
  'natural=bare_rock',
  'natural=tree_row',
  'natural=stone',
  'natural=wood',
  'natural=grassland',
  'natural=water',
  'amenity=hospital',
  'amenity=library',
  'amenity=fountain',
  'amenity=park',
]);

const KIND_KEYS = ['tourism', 'historic', 'leisure', 'amenity', 'natural'] as const;

function classify(tags: Record<string, string>): { key: string; spec: KindSpec } | null {
  for (const key of KIND_KEYS) {
    const value = tags[key];
    if (!value) continue;
    const composite = `${key}=${value}`;
    if (DROPPED.has(composite)) return null;
    const spec = KINDS[composite];
    if (spec) return { key: composite, spec };
  }
  return null;
}

function coordOf(el: OverpassElement) {
  if (el.lat != null && el.lon != null) return { lng: el.lon, lat: el.lat };
  if (el.center) return { lng: el.center.lon, lat: el.center.lat };
  return null;
}

/**
 * Prefer the English name. Many entries are Devanagari only, and a few pack both
 * into one string ("Gateway of India - गेटवे ऑफ इंडिया"), which reads badly in a
 * list of stops.
 */
function nameOf(tags: Record<string, string>): string | null {
  const english = tags['name:en']?.trim();
  if (english) return english;
  const name = tags.name?.trim();
  return name || null;
}

export function normalise(response: OverpassResponse): IngestedPoi[] {
  // A name shared by many places is a category, not a landmark. Counted across
  // the whole extract before scoring, so "Hanuman Mandir" is recognisably generic.
  const nameCounts = new Map<string, number>();
  for (const el of response.elements) {
    const name = el.tags ? nameOf(el.tags) : null;
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const out: IngestedPoi[] = [];

  for (const el of response.elements) {
    const tags = el.tags;
    if (!tags) continue;

    const name = nameOf(tags);
    if (!name) continue;

    const location = coordOf(el);
    if (!location) continue;

    const classified = classify(tags);
    if (!classified) continue;

    const { key, spec } = classified;
    const notable = Boolean(tags.wikidata || tags.wikipedia);

    // Raw score is deliberately unbounded. An earlier version clamped to 10 here
    // and twenty-two landmarks tied at exactly 10.0, so ordering inside the
    // notable tier collapsed to alphabetical and Gateway of India ranked 49th
    // behind a water park. Normalisation to 0..10 happens once, at the end.
    let score = spec.baseScore;

    // Notability is the only real importance signal OSM offers. Having both a
    // Wikidata entry and a Wikipedia article is a markedly stronger signal than
    // either alone, and it is what separates a landmark from a local curiosity.
    if (tags.wikidata && tags.wikipedia) score += 5;
    else if (notable) score += 3.5;

    if (tags['name:en']) score += 0.5;
    if (tags.website || tags['contact:website']) score += 0.8;
    if (tags.description || tags.image) score += 0.6;
    if (tags.heritage) score += 1.2;

    // Generic names are the strongest negative signal in the whole extract.
    const shared = nameCounts.get(name) ?? 1;
    if (shared > 5) score -= 4;
    else if (shared > 2) score -= 2.5;
    else if (shared > 1) score -= 1;

    const categories = [spec.category];
    if (tags.tourism === 'viewpoint' && spec.category !== 'views') categories.push('views');

    out.push({
      id: 0, // assigned after sorting, so ids follow rank
      sourceId: `${el.type}/${el.id}`,
      osmKind: key,
      name,
      location,
      visitDurationMin: spec.visitMin,
      popularity: score,
      categories,
      hours: parseOpeningHours(tags.opening_hours),
      notable,
    });
  }

  out.sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
  return assignIds(rescale(dedupe(out)));
}

/** Metres between two points, good enough for deciding "these are the same place". */
function metresApart(a: Candidate['location'], b: Candidate['location']): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const STOPWORDS = new Set(['the', 'of', 'and', 'dr', 'shri', 'sri', 'st', 'saint', 'mumbai']);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/**
 * OSM maps the same place more than once — as a node and again as the building
 * way, or under an English and a local name. The raw extract has two "Elephanta
 * Caves" and both "Bhau Daji Lad Museum (Victoria & Albert Museum)" and
 * "Dr. Bhau Daji Lad Museum".
 *
 * Input is already sorted best-first, so the first of any duplicate group wins.
 */
function dedupe(pois: IngestedPoi[]): IngestedPoi[] {
  const kept: IngestedPoi[] = [];

  for (const poi of pois) {
    const tokens = nameTokens(poi.name);

    const duplicate = kept.some((other) => {
      if (metresApart(poi.location, other.location) > 400) return false;
      const otherTokens = nameTokens(other.name);
      if (tokens.size === 0 || otherTokens.size === 0) return false;
      const shared = [...tokens].filter((t) => otherTokens.has(t)).length;
      // Either they share most of a name, or one name sits inside the other.
      return shared >= 2 || shared === Math.min(tokens.size, otherTokens.size);
    });

    if (!duplicate) kept.push(poi);
  }

  return kept;
}

/**
 * Map raw scores onto the 0..10 the solver expects, preserving order and using
 * the whole range. Done across the set rather than per-item so the spread
 * reflects how this city's data actually distributes.
 */
function rescale(pois: IngestedPoi[]): IngestedPoi[] {
  if (pois.length === 0) return pois;
  const scores = pois.map((p) => p.popularity);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  return pois.map((p) => ({
    ...p,
    popularity: Number((((p.popularity - min) / span) * 9.5 + 0.5).toFixed(2)),
  }));
}

const assignIds = (pois: IngestedPoi[]) => pois.map((poi, i) => ({ ...poi, id: i + 1 }));

/**
 * The cap that keeps the travel-time matrix affordable: it grows as N² per city
 * per mode, so 500 POIs is about a million rows and roughly 100 MB, while 1,200
 * would not fit the database's free tier at all.
 */
export function takeTop(pois: IngestedPoi[], limit = 500): IngestedPoi[] {
  return pois.slice(0, limit).map((poi, i) => ({ ...poi, id: i + 1 }));
}
