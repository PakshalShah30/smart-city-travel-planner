/**
 * Runs every solver over every scenario and reports how they compare.
 *
 * Also re-checks the hard invariants on each result. A solver that produced a
 * higher score by overrunning the budget or walking into a closed museum is not
 * winning, it is broken, and the table says so rather than quietly ranking it.
 */
import { isOpenDuring } from '../solver/hours';
import { realisedScore } from '../solver/score';
import type { AblationRow } from './ablation';
import type { Scenario } from './scenarios';
import { DEFAULT_WEIGHTS, type Solution, type Solver, type SolveRequest } from '../solver/types';

/**
 * Ways a solution can be illegal.
 *
 * `bad-schedule` and `score-mismatch` were added when the third solver landed.
 * Nothing here was relaxed to make room for it — the first four checks are
 * unchanged. The two new ones close the two cheapest ways a new solver could
 * have looked good without being good: reporting arrival times that do not
 * follow from the travel function, and reporting a total score that does not
 * follow from the stops it actually chose. Both are recomputed here from the
 * request, independently of whatever the solver believes.
 */
export type Violation =
  | 'over-budget'
  | 'closed-on-arrival'
  | 'duplicate-stop'
  | 'bad-return'
  | 'bad-schedule'
  | 'score-mismatch';

export function validate(solution: Solution, req: SolveRequest): Violation[] {
  const problems: Violation[] = [];

  if (solution.totalElapsedS > req.budgetMin * 60) problems.push('over-budget');

  const ids = solution.stops.map((s) => s.candidate.id);
  if (new Set(ids).size !== ids.length) problems.push('duplicate-stop');

  for (const stop of solution.stops) {
    if (!isOpenDuring(stop.candidate.hours, stop.arriveAt, stop.candidate.visitDurationMin)) {
      problems.push('closed-on-arrival');
      break;
    }
  }

  const lastDeparture = solution.stops.at(-1)?.departAt.getTime() ?? req.startAt.getTime();
  if (solution.endAt.getTime() !== lastDeparture + solution.returnTravelS * 1000) {
    problems.push('bad-return');
  }

  // Re-walk the clock from the request. A solver cannot fit more in by quoting
  // travel times it did not pay for, or by arriving before it left.
  let cursorMs = req.startAt.getTime();
  let prev = req.start;
  for (const stop of solution.stops) {
    const travelS = req.travelSeconds(prev, stop.candidate.location);
    const arriveMs = cursorMs + travelS * 1000;
    const departMs = arriveMs + stop.candidate.visitDurationMin * 60 * 1000;
    if (
      stop.travelFromPrevS !== travelS ||
      stop.arriveAt.getTime() !== arriveMs ||
      stop.departAt.getTime() !== departMs
    ) {
      problems.push('bad-schedule');
      break;
    }
    cursorMs = departMs;
    prev = stop.candidate.location;
  }

  // Re-score the chosen stops from scratch. A solver cannot win by grading its
  // own homework more generously than the others.
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const expected = solution.stops.reduce(
    (sum, s) => sum + realisedScore(s.candidate, req.interests, weights),
    0,
  );
  if (Math.abs(expected - solution.totalScore) > 1e-9) problems.push('score-mismatch');

  return problems;
}

export type SolverSummary = {
  name: string;
  label: string;
  meanScore: number;
  meanStops: number;
  meanSlackMin: number;
  /** Share of the time budget actually used, 0..1. */
  meanUtilisation: number;
  p50Ms: number;
  p95Ms: number;
  /** Worst single solve. The number that decides whether this is usable online. */
  maxMs: number;
  violations: number;
};

export type HeadToHead = {
  winner: string;
  against: string;
  wins: number;
  losses: number;
  ties: number;
};

export type BenchmarkResult = {
  scenarioCount: number;
  summaries: SolverSummary[];
  /** Of scenarios where the two differ, the share the first solver wins. */
  headToHead: HeadToHead;
  /**
   * Each solver against the one listed before it. With three solvers this is
   * what answers "did the newest step actually buy anything", which comparing
   * everything against the naive baseline hides.
   */
  steps: HeadToHead[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function runBenchmark(scenarios: Scenario[], solvers: Solver[]): BenchmarkResult {
  const byScenario = new Map<string, Map<string, Solution>>();

  const summaries = solvers.map((solver) => {
    const scores: number[] = [];
    const stops: number[] = [];
    const slack: number[] = [];
    const utilisation: number[] = [];
    const times: number[] = [];
    let violations = 0;

    for (const scenario of scenarios) {
      const solution = solver.solve(scenario.request);
      if (!byScenario.has(scenario.id)) byScenario.set(scenario.id, new Map());
      byScenario.get(scenario.id)!.set(solver.name, solution);

      if (validate(solution, scenario.request).length > 0) violations += 1;

      scores.push(solution.totalScore);
      stops.push(solution.stops.length);
      slack.push(solution.slackS / 60);
      utilisation.push(solution.totalElapsedS / (scenario.request.budgetMin * 60));
      times.push(solution.solveMs);
    }

    return {
      name: solver.name,
      label: solver.label,
      meanScore: mean(scores),
      meanStops: mean(stops),
      meanSlackMin: mean(slack),
      meanUtilisation: mean(utilisation),
      p50Ms: percentile(times, 50),
      p95Ms: percentile(times, 95),
      maxMs: times.length ? Math.max(...times) : 0,
      violations,
    };
  });

  const compare = (challenger: Solver, baseline: Solver): HeadToHead => {
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const scenario of scenarios) {
      const a = byScenario.get(scenario.id)?.get(challenger.name)?.totalScore ?? 0;
      const b = byScenario.get(scenario.id)?.get(baseline.name)?.totalScore ?? 0;
      if (Math.abs(a - b) < 1e-9) ties += 1;
      else if (a > b) wins += 1;
      else losses += 1;
    }
    return { winner: challenger.label, against: baseline.label, wins, losses, ties };
  };

  // Head to head between the last solver (newest) and the first (the baseline).
  const headToHead = compare(solvers[solvers.length - 1], solvers[0]);

  // And each solver against its immediate predecessor, so a step that adds
  // nothing cannot hide behind the gap the previous step opened up.
  const steps = solvers.slice(1).map((solver, i) => compare(solver, solvers[i]));

  return { scenarioCount: scenarios.length, summaries, headToHead, steps };
}

export function toMarkdown(
  result: BenchmarkResult,
  generatedOn: string,
  ablation?: AblationRow[],
): string {
  const rows = result.summaries
    .map(
      (s) =>
        `| ${s.label} | ${s.meanScore.toFixed(1)} | ${s.meanStops.toFixed(1)} | ${(
          s.meanUtilisation * 100
        ).toFixed(0)}% | ${s.meanSlackMin.toFixed(0)}m | ${s.p50Ms}ms | ${s.p95Ms}ms | ${
          s.maxMs
        }ms | ${s.violations} |`,
    )
    .join('\n');

  const best = result.summaries.reduce((a, b) => (b.meanScore > a.meanScore ? b : a));
  const worst = result.summaries.reduce((a, b) => (b.meanScore < a.meanScore ? b : a));
  const lift =
    worst.meanScore > 0 ? ((best.meanScore - worst.meanScore) / worst.meanScore) * 100 : 0;

  // One sentence per step, so a step that bought almost nothing says so.
  const stepLines = result.summaries
    .slice(1)
    .map((s, i) => {
      const prev = result.summaries[i];
      const gain = prev.meanScore > 0 ? ((s.meanScore - prev.meanScore) / prev.meanScore) * 100 : 0;
      const h2h = result.steps[i];
      return (
        `- **${s.label}** scores ${gain >= 0 ? '+' : ''}${gain.toFixed(1)}% over ` +
        `${prev.label} (${prev.meanScore.toFixed(1)} to ${s.meanScore.toFixed(1)}), ` +
        `winning ${h2h.wins}, losing ${h2h.losses} and tying ${h2h.ties} of ` +
        `${result.scenarioCount}.`
      );
    })
    .join('\n');

  const { winner, against, wins, losses, ties } = result.headToHead;

  const ablationSection = ablation?.length
    ? `
## What each local-search move bought

Local search is four moves in a trench coat, so here is each of them measured
separately against the greedy solution it starts from. The control row has every
move switched off: it must read 0.00%, because it is the same tour greedy
produced. If it ever does not, the comparison below is meaningless.

| Moves enabled | Mean score | Gain over greedy | W-L-T vs greedy | Checks (mean/worst) |
| --- | --- | --- | --- | --- |
${ablation
  .map(
    (a) =>
      `| ${a.label} | ${a.meanScore.toFixed(2)} | ${a.gainPct >= 0 ? '+' : ''}${a.gainPct.toFixed(
        2,
      )}% | ${a.wins}-${a.losses}-${a.ties} | ${Math.round(a.meanEvaluations)} / ${
        a.maxEvaluations
      }${a.truncated ? ' (truncated)' : ''} |`,
  )
  .join('\n')}

"Checks" counts calls to \`buildTimeline\`, the shared feasibility function every
move has to go through. It is used here instead of milliseconds because it is
deterministic: wall-clock worst-case swings several-fold between runs on the
same machine and would make this table unreproducible.

Reordering on its own scores exactly nothing, and that is the point rather than
a disappointment: the objective is the value of the SET of stops visited, so
reversing a segment cannot change it. Reordering pays only through the time it
frees for the insert phase, and on this candidate set it frees a few minutes at
a time against a shortest dwell time of 20 minutes — so it converts into a stop
on only a handful of days.
`
    : '';

  return `# Solver benchmark

Generated ${generatedOn} · ${result.scenarioCount} scenarios · regenerate with \`npm run benchmark\`.

Scenarios are seeded, so this table is reproducible. They vary the starting
point, the day of the week (including days when some places are shut), the start
hour, the time budget from 2 to 10 hours, and zero to three stated interests.

| Solver | Mean score | Mean stops | Budget used | Slack | p50 | p95 | max | Invalid |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

**${best.label} scores ${lift.toFixed(0)}% higher than ${worst.label}.** Head to
head, ${winner} beats ${against} on ${wins} of ${result.scenarioCount} scenarios,
loses ${losses} and ties ${ties}.

Step by step, each solver against the one before it:

${stepLines}

"Invalid" counts solutions that broke a hard constraint — over budget, a stop
that was shut on arrival, a duplicated stop, an end time that does not account
for the journey home, a schedule whose arrival times do not follow from the
travel function, or a total score that does not follow from the stops chosen.
Any number above zero is a bug, not a trade-off.
${ablationSection}
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
`;
}
