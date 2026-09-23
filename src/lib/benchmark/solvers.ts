/**
 * The canonical list of solvers the benchmark compares, newest last.
 *
 * Order matters: `runBenchmark` reports each solver against the one before it,
 * and the headline head-to-head is the last against the first. Adding a solver
 * to the benchmark should be one line here, not an edit in every caller.
 */
import { POPULARITY_FIRST } from '../solver/baselines';
import { GREEDY } from '../solver/greedy';
import { GREEDY_LOCAL } from '../solver/local-search';
import type { Solver } from '../solver/types';

export const BENCHMARK_SOLVERS: readonly Solver[] = [POPULARITY_FIRST, GREEDY, GREEDY_LOCAL];
