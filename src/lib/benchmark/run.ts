/**
 * Runs every solver over every scenario and reports how they compare.
 *
 * Also re-checks the hard invariants on each result. A solver that produced a
 * higher score by overrunning the budget or walking into a closed museum is not
 * winning, it is broken, and the table says so rather than quietly ranking it.
 */
import { isOpenDuring } from '../solver/hours';
import type { Scenario } from './scenarios';
import type { Solution, Solver, SolveRequest } from '../solver/types';

export type Violation = 'over-budget' | 'closed-on-arrival' | 'duplicate-stop' | 'bad-return';

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
  violations: number;
};

export type BenchmarkResult = {
  scenarioCount: number;
  summaries: SolverSummary[];
  /** Of scenarios where the two differ, the share the first solver wins. */
  headToHead: { winner: string; against: string; wins: number; losses: number; ties: number };
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
      violations,
    };
  });

  // Head to head between the last solver (newest) and the first (the baseline).
  const challenger = solvers[solvers.length - 1];
  const baseline = solvers[0];
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

  return {
    scenarioCount: scenarios.length,
    summaries,
    headToHead: { winner: challenger.label, against: baseline.label, wins, losses, ties },
  };
}

export function toMarkdown(result: BenchmarkResult, generatedOn: string): string {
  const rows = result.summaries
    .map(
      (s) =>
        `| ${s.label} | ${s.meanScore.toFixed(1)} | ${s.meanStops.toFixed(1)} | ${(
          s.meanUtilisation * 100
        ).toFixed(0)}% | ${s.meanSlackMin.toFixed(0)}m | ${s.p50Ms}ms | ${s.p95Ms}ms | ${
          s.violations
        } |`,
    )
    .join('\n');

  const best = result.summaries.reduce((a, b) => (b.meanScore > a.meanScore ? b : a));
  const worst = result.summaries.reduce((a, b) => (b.meanScore < a.meanScore ? b : a));
  const lift =
    worst.meanScore > 0 ? ((best.meanScore - worst.meanScore) / worst.meanScore) * 100 : 0;

  const { winner, against, wins, losses, ties } = result.headToHead;

  return `# Solver benchmark

Generated ${generatedOn} · ${result.scenarioCount} scenarios · regenerate with \`npm run benchmark\`.

Scenarios are seeded, so this table is reproducible. They vary the starting
point, the day of the week (including days when some places are shut), the start
hour, the time budget from 2 to 10 hours, and zero to three stated interests.

| Solver | Mean score | Mean stops | Budget used | Slack | p50 | p95 | Invalid |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

**${best.label} scores ${lift.toFixed(0)}% higher than ${worst.label}.** Head to
head, ${winner} beats ${against} on ${wins} of ${result.scenarioCount} scenarios,
loses ${losses} and ties ${ties}.

"Invalid" counts solutions that broke a hard constraint — over budget, a stop
that was shut on arrival, a duplicated stop, or an end time that does not
account for the journey home. Any number above zero is a bug, not a trade-off.

## Reading this

Mean score is the sum of per-stop scores across a day, so it rewards both
picking good places and fitting more of them in. Budget used is the share of the
available time the plan actually consumes; a solver leaving large slack is
failing to find things that fit, not being considerate.
`;
}
