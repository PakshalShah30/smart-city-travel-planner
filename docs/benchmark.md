# Solver benchmark

Generated 2026-09-19 · 50 scenarios · regenerate with `npm run benchmark`.

Scenarios are seeded, so this table is reproducible. They vary the starting
point, the day of the week (including days when some places are shut), the start
hour, the time budget from 2 to 10 hours, and zero to three stated interests.

| Solver | Mean score | Mean stops | Budget used | Slack | p50 | p95 | Invalid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Popularity first (naive) | 28.8 | 5.1 | 96% | 10m | 0ms | 1ms | 0 |
| Greedy insertion | 38.4 | 8.0 | 94% | 15m | 1ms | 5ms | 0 |

**Greedy insertion scores 33% higher than Popularity first (naive).** Head to
head, Greedy insertion beats Popularity first (naive) on 48 of 50 scenarios,
loses 2 and ties 0.

"Invalid" counts solutions that broke a hard constraint — over budget, a stop
that was shut on arrival, a duplicated stop, or an end time that does not
account for the journey home. Any number above zero is a bug, not a trade-off.

## Reading this

Mean score is the sum of per-stop scores across a day, so it rewards both
picking good places and fitting more of them in. Budget used is the share of the
available time the plan actually consumes; a solver leaving large slack is
failing to find things that fit, not being considerate.
