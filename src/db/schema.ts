/**
 * Smart City Travel Planner — database schema.
 *
 * Design notes that are easy to lose later:
 *  - Locations are PostGIS `geometry(Point,4326)`, not `geography`. Drizzle's
 *    customType quotes any type containing parentheses, which emits
 *    `"geography(Point,4326)"` and fails as an unknown type, so we use Drizzle's
 *    built-in `geometry` and cast at query time: `location::geography` gives
 *    distances in metres on a spheroid, e.g.
 *    `ST_DWithin(location::geography, $start::geography, $radiusMetres)`.
 *  - Each location column carries a GIST index. At a few hundred POIs per city a
 *    scan would be fine; the index matters once ingestion grows. Note it indexes
 *    the geometry, not the geography cast — if the tables ever get large enough
 *    for that to matter, add an expression index via `drizzle-kit generate --custom`.
 *  - `travel_times` is the precomputed POI-to-POI matrix. It is deliberately NOT
 *    computed per request: an N-to-N matrix is O(N^2), so we build it once per city
 *    at ingestion and read it back as a plain lookup.
 *  - A user's start point is arbitrary (geocoded, not a POI), so its legs are the
 *    one part of the matrix computed on demand and cached separately.
 *  - `opening_hours` is structured JSON, never the raw OSM string. Parsing happens
 *    once during ingestion so the solver never has to think about it.
 */
import {
  boolean,
  doublePrecision,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * A WGS84 point column. Values are `{ x: longitude, y: latitude }` — note the
 * order: x is longitude, which is the opposite of how coordinates are usually
 * spoken aloud. Cast to geography in queries that need metres.
 */
const point = (name: string) => geometry(name, { type: 'point', mode: 'xy', srid: 4326 });

/** `{ x: longitude, y: latitude }`, as stored in any point column below. */
export type LngLat = { x: number; y: number };

/** One structured opening window. `day` is 0=Sunday .. 6=Saturday. */
export type OpeningWindow = {
  day: number;
  /** Minutes from midnight, local to the city's timezone. */
  opensMin: number;
  closesMin: number;
};

export type OpeningHours = {
  /** Empty array means "no data"; check `alwaysOpen` before treating it as closed. */
  windows: OpeningWindow[];
  alwaysOpen: boolean;
  /** True when the source string could not be parsed; the solver treats these as open. */
  unparsed: boolean;
  /** The original OSM value, kept so ingestion bugs are debuggable. */
  raw?: string;
};

export const cities = pgTable(
  'cities',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    center: point('center').notNull(),
    /** Default candidate radius, in metres, around the user's start point. */
    defaultRadiusM: integer('default_radius_m').notNull().default(5000),
    /** IANA name, e.g. "Asia/Kolkata". Opening hours are local to this. */
    timezone: text('timezone').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cities_slug_key').on(t.slug),
    index('cities_center_idx').using('gist', t.center),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
);

export const pois = pgTable(
  'pois',
  {
    id: serial('id').primaryKey(),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    /** Where this row came from: 'osm' | 'google' | 'manual'. */
    source: text('source').notNull(),
    /** Identifier within that source, e.g. an OSM "node/240109189". */
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    location: point('location').notNull(),
    /** Typical dwell time in minutes. Drives the time budget. */
    visitDurationMin: integer('visit_duration_min').notNull(),
    /** Normalised 0-10. Blended from rating, rating count and source signals. */
    popularity: real('popularity').notNull().default(0),
    rating: real('rating'),
    ratingCount: integer('rating_count'),
    primaryCategoryId: integer('primary_category_id').references(() => categories.id),
    openingHours: jsonb('opening_hours').$type<OpeningHours>(),
    address: text('address'),
    photoRef: text('photo_ref'),
    /** Raw source tags, kept for debugging the normalisation layer. */
    tags: jsonb('tags').$type<Record<string, string>>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pois_source_key').on(t.source, t.sourceId),
    index('pois_city_idx').on(t.cityId),
    index('pois_location_idx').using('gist', t.location),
  ],
);

export const poiCategories = pgTable(
  'poi_categories',
  {
    poiId: integer('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.poiId, t.categoryId] })],
);

/** Precomputed pairwise travel times. One row per ordered pair per mode. */
export const travelTimes = pgTable(
  'travel_times',
  {
    fromPoiId: integer('from_poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    toPoiId: integer('to_poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    /** 'foot' | 'car' | 'transit'. */
    mode: text('mode').notNull(),
    durationS: integer('duration_s').notNull(),
    distanceM: integer('distance_m').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromPoiId, t.toPoiId, t.mode] })],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const itineraries = pgTable(
  'itineraries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for plans made without an account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    /** Public read-only link. Null until the user shares it. */
    shareSlug: text('share_slug'),
    title: text('title').notNull(),
    startLabel: text('start_label').notNull(),
    startLocation: point('start_location').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    budgetMin: integer('budget_min').notNull(),
    /** Category slugs the user selected. */
    interests: jsonb('interests').$type<string[]>().notNull().default([]),
    /** Solver outputs, kept so results are reproducible and benchmarkable. */
    totalScore: doublePrecision('total_score').notNull().default(0),
    totalTravelS: integer('total_travel_s').notNull().default(0),
    totalVisitS: integer('total_visit_s').notNull().default(0),
    /** Which algorithm produced this: 'greedy' | 'two-opt' | 'ortools'. */
    solver: text('solver').notNull(),
    solveMs: integer('solve_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('itineraries_share_slug_key').on(t.shareSlug),
    index('itineraries_user_idx').on(t.userId),
  ],
);

export const itineraryStops = pgTable(
  'itinerary_stops',
  {
    id: serial('id').primaryKey(),
    itineraryId: uuid('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    poiId: integer('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'restrict' }),
    /** 0-based position in the route. */
    seq: integer('seq').notNull(),
    arriveAt: timestamp('arrive_at', { withTimezone: true }).notNull(),
    departAt: timestamp('depart_at', { withTimezone: true }).notNull(),
    /** Travel time from the previous stop, or from the start point when seq is 0. */
    travelFromPrevS: integer('travel_from_prev_s').notNull(),
    score: doublePrecision('score').notNull().default(0),
    /** User pinned this stop; re-solving must keep it. */
    locked: boolean('locked').notNull().default(false),
  },
  (t) => [uniqueIndex('itinerary_stops_seq_key').on(t.itineraryId, t.seq)],
);
