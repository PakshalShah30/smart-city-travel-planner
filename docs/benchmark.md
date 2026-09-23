# Solver benchmark

Generated 2026-09-23 · 50 scenarios · regenerate with `npm run benchmark`.

Scenarios are seeded, so this table is reproducible. They vary the starting
point, the day of the week (including days when some places are shut), the start
hour, the time budget from 2 to 10 hours, and zero to three stated interests.

| Solver | Mean score | Mean stops | Budget used | Slack | p50 | p95 | max | Invalid |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Popularity first (naive) | 28.8 | 5.1 | 96% | 10m | 0ms | 1ms | 1ms | 0 |
| Greedy insertion | 38.4 | 8.0 | 94% | 15m | 1ms | 5ms | 8ms | 0 |
| Greedy + local search | 40.4 | 8.2 | 97% | 5m | 4ms | 19ms | 25ms | 0 |

**Greedy + local search scores 41% higher than Popularity first (naive).** Head to
head, Greedy + local search beats Popularity first (naive) on 50 of 50 scenarios,
loses 0 and ties 0.

Step by step, each solver against the one before it:

- **Greedy insertion** scores +33.4% over Popularity first (naive) (28.8 to 38.4), winning 48, losing 2 and tying 0 of 50.
- **Greedy + local search** scores +5.4% over Greedy insertion (38.4 to 40.4), winning 39, losing 0 and tying 11 of 50.

"Invalid" counts solutions that broke a hard constraint — over budget, a stop
that was shut on arrival, a duplicated stop, an end time that does not account
for the journey home, a schedule whose arrival times do not follow from the
travel function, or a total score that does not follow from the stops chosen.
Any number above zero is a bug, not a trade-off.

## What each local-search move bought

Local search is four moves in a trench coat, so here is each of them measured
separately against the greedy solution it starts from. The control row has every
move switched off: it must read 0.00%, because it is the same tour greedy
produced. If it ever does not, the comparison below is meaningless.

| Moves enabled | Mean score | Gain over greedy | W-L-T vs greedy | Checks (mean/worst) |
| --- | --- | --- | --- | --- |
| no moves (control — must be 0.00%) | 38.37 | +0.00% | 0-0-50 | 1 / 1 |
| reorder only (2-opt + Or-opt) | 38.37 | +0.00% | 0-0-50 | 1389 / 7929 |
| insert only | 38.37 | +0.00% | 0-0-50 | 249 / 353 |
| insert + swap | 39.96 | +4.13% | 40-0-10 | 2946 / 13617 |
| 2-opt + insert + swap (default) | 40.44 | +5.40% | 39-0-11 | 3361 / 13055 |
| Or-opt + insert + swap | 40.47 | +5.46% | 39-0-11 | 5415 / 18910 |
| both reorders + insert + swap | 40.41 | +5.31% | 39-0-11 | 5645 / 20853 |
| default + eject | 40.87 | +6.52% | 39-0-11 | 14724 / 60964 |

"Checks" counts calls to `buildTimeline`, the shared feasibility function every
move has to go through. It is used here instead of milliseconds because it is
deterministic: wall-clock worst-case swings several-fold between runs on the
same machine and would make this table unreproducible.

Reordering on its own scores exactly nothing, and that is the point rather than
a disappointment: the objective is the value of the SET of stops visited, so
reversing a segment cannot change it. Reordering pays only through the time it
frees for the insert phase, and on this candidate set it frees a few minutes at
a time against a shortest dwell time of 20 minutes — so it converts into a stop
on only a handful of days.

## Reading this

Mean score is the sum of per-stop scores across a day, so it rewards both
picking good places and fitting more of them in. Budget used is the share of the
available time the plan actually consumes; a solver leaving large slack is
failing to find things that fit, not being considerate.

One property worth knowing before reading too much into a reordering: the score
of a finished plan does not depend on the order of its stops. The variety term
rewards a candidate for bringing a category the day does not have yet, and in a
finished plan every chosen stop's categories are already in the day, so variety
contributes zero to every reported total. Variety steers the search; it is not
part of the objective. That makes this an orienteering problem — pick the most
valuable set of stops that fits the clock — and it is why a shorter tour is
worth nothing until the time it saves is spent.

Solve times are wall-clock on one machine and move between runs; treat them as
orders of magnitude, not measurements. Everything else in this file is
deterministic and should reproduce exactly.
