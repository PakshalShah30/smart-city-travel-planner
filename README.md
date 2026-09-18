# Smart City Travel Planner

Give it a city, a starting point and a time budget. It returns a routed day plan
through real places, using real street-network travel times, that gets you back
where you started before your time runs out.

This is a ground-up rebuild of a 2018–19 university project of the same name
([PakshalShah30/SmartCityTravelPlanner](https://github.com/PakshalShah30/SmartCityTravelPlanner)).
The original specified three itinerary modes, route optimization, ratings and
opening-hours awareness, and shipped a two-column SQL lookup over four rows of
placeholder data. This repository is the honest version of that specification,
and it tracks the gap deliberately — see `docs/traceability.md` once it lands.

## The problem

Picking a day out is not a sorting problem. Every attraction has a location, a
visit duration, an opening window and a value to a particular person. You have a
fixed budget and must return to your start. Choosing the best subset *and* the
best order is the **Orienteering Problem** — NP-hard, and in the tourism
literature the Tourist Trip Design Problem.

The solver runs in three stages, all kept so each is a benchmark baseline for
the next: greedy insertion, then 2-opt and Or-opt local search, then a
constrained solver with time windows.

## Status

Phase 0 of 6. The application is scaffolded, the data model is defined and CI is
green. There is no working planner yet.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundations: scaffold, data model, CI, deploy | In progress |
| 1 | Thin vertical slice: seeded data, greedy solver, first itinerary | Not started |
| 2 | Real data: OSM ingestion, OSRM travel-time matrices, two cities | Not started |
| 3 | The optimizer: local search, constrained solver, published benchmark | Not started |
| 4 | Product surface: map, accounts, share links, mobile | Not started |
| 5 | Ship: end-to-end tests, docs, performance, launch | Not started |

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Postgres with PostGIS via
Drizzle · Vitest. The optimizer arrives in Phase 3 as a separate Python service,
because the solver libraries for this problem class live in Python; the app falls
back to its built-in greedy solver whenever that service is unavailable.

## Running it locally

Requires Node 22 or newer and a Neon Postgres project (PostGIS enabled).

```bash
npm install
neon link
npm run db:generate
npm run db:migrate
npm run dev
```

`neon link` writes `DATABASE_URL` into `.env.local`. `db:migrate` runs
`scripts/enable-postgis.mjs` before applying migrations, because the extension has
to exist before any `geography` column can be created and drizzle-kit has no
pre-migration hook. It is idempotent, so it is safe on every run.

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # production build
```

## Data model

Seven tables. Three decisions worth knowing about:

- Locations are PostGIS `geography(Point,4326)`, so distances are metres on a
  spheroid and proximity filtering happens in the database, not in application code.
- `travel_times` is a **precomputed** pairwise matrix, built once per city at
  ingestion. An N-to-N matrix is O(N²); computing it per request would be both
  slow and expensive. The user's start point is the one exception, since it is
  geocoded rather than a POI, so its legs are computed on demand.
- `opening_hours` is structured JSON, parsed once during ingestion. The solver
  never sees a raw OSM `opening_hours` string, and unparseable values are flagged
  and treated as open rather than crashing the pipeline.

## Licence

Not yet chosen.
