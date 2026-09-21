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

The solver runs in stages, all kept so each is a baseline for the next: a naive
popularity-first control, greedy insertion, then 2-opt and Or-opt local search,
then a constrained solver with time windows.

Current standing over 50 seeded scenarios — greedy insertion scores **33% higher**
than the naive baseline, winning 48 of 50, with zero constraint violations from
either. Full table and method in [docs/benchmark.md](docs/benchmark.md);
regenerate with `npm run benchmark`.

## Status

Phase 1 of 5. The planner works end to end on seeded data: give it a start point
and a time budget and it returns a routed, time-feasible itinerary. Travel times
are still straight-line estimates rather than street-network routing, and the
solver is greedy insertion only, so the itineraries are feasible but not yet good.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundations: scaffold, data model, CI, deploy | Done |
| 1 | Thin vertical slice: seeded data, greedy solver, first itinerary | Done |
| 2 | Real data: OSM ingestion, OSRM travel-time matrices, two cities | Next |
| 3 | The optimizer: local search, constrained solver, published benchmark | Not started |
| 4 | Product surface: map, accounts, share links, mobile | Not started |
| 5 | Ship: end-to-end tests, docs, performance, launch | Not started |

Phase 1 shipped geo primitives, opening-hours parsing, a scoring function, the
schedule builder, greedy insertion, Mumbai seed data, and a planner UI wired to
the solver, with unit tests across each.

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

## Building a city's data

Three steps, all one-time per city. The deployed application never calls a
routing engine — every leg it needs is precomputed and stored, including the
legs from each start point, which is why the start points sit in the matrix
alongside the places.

```bash
./scripts/fetch-overpass.sh mumbai     # raw OSM extract
./scripts/osrm-up.sh car               # local routing engine, leave running
npm run build-matrix                   # in another terminal
npm run db:seed
```

OSRM is a build-time tool, like a compiler. Once the matrix is in Postgres you
can stop the container and delete `osrm-data/`. Docker is needed only for this;
on macOS `brew install colima docker && colima start` is lighter than Docker
Desktop. For walking legs too, run `./scripts/osrm-up.sh foot` on port 5101
before building the matrix. The ports start at 5100 because macOS's AirPlay
Receiver holds 5000.

At 500 places plus 5 start points that is 257,556 ordered pairs per mode,
collected in 121 requests. Pairs more than 45 minutes apart are not stored: no
six-hour day contains a 45-minute leg between consecutive stops, and dropping
them is most of what keeps the table inside the database's free tier.

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
  and treated as open rather than crashing the pipeline. The parser handles
  97.6% of the real values in the Mumbai extract; the rest are things like
  `"2hrs"` and are deliberately left unknown rather than guessed at.

## Ranking places without ratings

OpenStreetMap has no ratings, which is the central problem of ingestion. The
Mumbai extract is 3,060 elements: 1,177 are unnamed, and of the rest there are
742 places of worship and 657 parks — seventeen "Hanuman Mandir", ten "BMC
Park". Nothing in the tags separates the Siddhivinayak Temple from a shrine on a
side street.

The one strong signal is notability. Only about eighty elements carry a Wikidata
entry or a Wikipedia article, but they are almost exactly the right eighty:
Gateway of India, Elephanta Caves, Haji Ali, Bhau Daji Lad, Flora Fountain,
Crawford Market. So notability drives a pre-ranking, co-located duplicates are
merged, generic names are penalised, and the top of that list is what gets
enriched with real ratings from Google Places — a few hundred calls rather than
several thousand.

## Licence

Not yet chosen.
