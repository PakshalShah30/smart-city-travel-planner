/**
 * Regenerates docs/benchmark.md.
 *
 * Run with `npm run benchmark`. Requires Node 22+, which strips the types.
 */
import { writeFileSync } from 'node:fs';

import { generateScenarios } from '../src/lib/benchmark/scenarios';
import { runBenchmark, toMarkdown } from '../src/lib/benchmark/run';
import { GREEDY } from '../src/lib/solver/greedy';
import { POPULARITY_FIRST } from '../src/lib/solver/baselines';

const scenarios = generateScenarios(50);
const result = runBenchmark(scenarios, [POPULARITY_FIRST, GREEDY]);

const today = new Date().toISOString().slice(0, 10);
writeFileSync('docs/benchmark.md', toMarkdown(result, today));

for (const s of result.summaries) {
  console.log(
    `${s.label.padEnd(26)} score ${s.meanScore.toFixed(1).padStart(6)}` +
      `  stops ${s.meanStops.toFixed(1).padStart(4)}` +
      `  used ${(s.meanUtilisation * 100).toFixed(0).padStart(3)}%` +
      `  p95 ${String(s.p95Ms).padStart(3)}ms` +
      `  invalid ${s.violations}`,
  );
}

const { winner, against, wins, losses, ties } = result.headToHead;
console.log(`\n${winner} vs ${against}: ${wins} wins, ${losses} losses, ${ties} ties`);
console.log('docs/benchmark.md written');

const broken = result.summaries.filter((s) => s.violations > 0);
if (broken.length > 0) {
  console.error(`\nFAILED: ${broken.map((s) => s.label).join(', ')} produced invalid plans`);
  process.exit(1);
}
