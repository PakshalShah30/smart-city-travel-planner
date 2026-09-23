/**
 * Regenerates docs/benchmark.md.
 *
 * Run with `npm run benchmark`. Requires Node 22+, which strips the types.
 */
import { writeFileSync } from 'node:fs';

import { generateScenarios } from '../src/lib/benchmark/scenarios';
import { runBenchmark, toMarkdown } from '../src/lib/benchmark/run';
import { runMoveAblation } from '../src/lib/benchmark/ablation';
import { BENCHMARK_SOLVERS } from '../src/lib/benchmark/solvers';

const scenarios = generateScenarios(50);
// One registry, so adding a solver does not mean remembering to edit this file.
const result = runBenchmark(scenarios, [...BENCHMARK_SOLVERS]);

const today = new Date().toISOString().slice(0, 10);
writeFileSync('docs/benchmark.md', toMarkdown(result, today, runMoveAblation(scenarios)));

for (const s of result.summaries) {
  console.log(
    `${s.label.padEnd(26)} score ${s.meanScore.toFixed(1).padStart(6)}` +
      `  stops ${s.meanStops.toFixed(1).padStart(4)}` +
      `  used ${(s.meanUtilisation * 100).toFixed(0).padStart(3)}%` +
      `  p95 ${String(s.p95Ms).padStart(3)}ms` +
      `  invalid ${s.violations}`,
  );
}

// Each solver against the one before it: with three solvers, comparing only
// against the naive baseline would let a step that adds nothing hide behind
// the gap the previous step opened.
for (const { winner, against, wins, losses, ties } of result.steps) {
  console.log(`\n${winner} vs ${against}: ${wins} wins, ${losses} losses, ${ties} ties`);
}
console.log('docs/benchmark.md written');

const broken = result.summaries.filter((s) => s.violations > 0);
if (broken.length > 0) {
  console.error(`\nFAILED: ${broken.map((s) => s.label).join(', ')} produced invalid plans`);
  process.exit(1);
}
