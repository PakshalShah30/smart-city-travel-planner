/**
 * Which local-search moves actually earned their place.
 *
 * A solver that bundles four moves together and reports one number tells you
 * nothing about any of them. This turns each move off in turn and re-measures,
 * so the table can say "2-opt bought 1.0 points" rather than implying the whole
 * gain came from every part of it equally.
 *
 * The baseline is the greedy solution each configuration starts from, so a
 * configuration with every move disabled scores exactly 0.00% by construction —
 * which is also the control for "did this improve, or did it just start from a
 * different place?". If that row is ever not 0.00%, something upstream of the
 * moves has changed and the rest of the table means nothing.
 */
import { solveGreedy } from '../solver/greedy';
import { solveGreedyLocalWithStats, type LocalSearchOptions } from '../solver/local-search';
import type { Scenario } from './scenarios';

export type AblationRow = {
  label: string;
  meanScore: number;
  /** Percentage points above the greedy solution the search starts from. */
  gainPct: number;
  wins: number;
  losses: number;
  ties: number;
  /**
   * Worst single solve, counted in `buildTimeline` calls rather than
   * milliseconds. Wall-clock worst-case moves several-fold between runs on the
   * same machine, which would make this table unreproducible; the number of
   * feasibility checks is exact, deterministic and the thing that actually
   * drives the cost.
   */
  maxEvaluations: number;
  /** Mean `buildTimeline` calls per scenario. */
  meanEvaluations: number;
  /** True when any scenario hit the `buildTimeline` budget before converging. */
  truncated: boolean;
};

const NONE = { twoOpt: false, orOpt: false, insert: false, swap: false, eject: false } as const;

/** Off by default in DEFAULT_MOVES, so the table has to switch them on. */
const EVERYTHING = { twoOpt: true, orOpt: true, insert: true, swap: true } as const;

const CONFIGURATIONS: Array<{ label: string; options: Partial<LocalSearchOptions> }> = [
  { label: 'no moves (control — must be 0.00%)', options: NONE },
  { label: 'reorder only (2-opt + Or-opt)', options: { ...NONE, twoOpt: true, orOpt: true } },
  { label: 'insert only', options: { ...NONE, insert: true } },
  { label: 'insert + swap', options: { ...NONE, insert: true, swap: true } },
  { label: '2-opt + insert + swap (default)', options: {} },
  { label: 'Or-opt + insert + swap', options: { ...EVERYTHING, twoOpt: false } },
  { label: 'both reorders + insert + swap', options: EVERYTHING },
  {
    label: 'default + eject',
    options: { eject: true, maxEvaluations: 2_000_000 },
  },
];

export function runMoveAblation(scenarios: Scenario[]): AblationRow[] {
  const baseline = scenarios.map((s) => solveGreedy(s.request).totalScore);
  const baselineMean = baseline.reduce((a, b) => a + b, 0) / Math.max(1, baseline.length);

  return CONFIGURATIONS.map(({ label, options }) => {
    let total = 0;
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let maxEvaluations = 0;
    let totalEvaluations = 0;
    let truncated = false;

    scenarios.forEach((scenario, i) => {
      const { solution, stats } = solveGreedyLocalWithStats(scenario.request, options);
      maxEvaluations = Math.max(maxEvaluations, stats.evaluations);
      totalEvaluations += stats.evaluations;
      truncated = truncated || stats.budgetExhausted;

      total += solution.totalScore;
      const delta = solution.totalScore - baseline[i];
      if (Math.abs(delta) < 1e-9) ties += 1;
      else if (delta > 0) wins += 1;
      else losses += 1;
    });

    const meanScore = total / Math.max(1, scenarios.length);
    return {
      label,
      meanScore,
      gainPct: baselineMean > 0 ? ((meanScore - baselineMean) / baselineMean) * 100 : 0,
      wins,
      losses,
      ties,
      maxEvaluations,
      meanEvaluations: totalEvaluations / Math.max(1, scenarios.length),
      truncated,
    };
  });
}
